// controllers/campaignController.js
import Campaign from "../models/Campaign.js";
import { fetchAllCampaigns } from "../utils/blockchain.js";
import { ethers } from "ethers";

/**
 * These controllers serve:
 * - /campaign-db/*  (metadata admin)
 * - /createCampaign, /campaigns, /campaign/:id (blockchain)
 *
 * They expect req.app.locals.contract to be set when blockchain features are used.
 */

export const createCampaignOnBlockchain = async (req, res) => {
  const contract = req.app.locals.contract;
  if (!contract) return res.status(503).json({ success: false, error: "Blockchain not configured" });

  try {
    const { title, description, goal, durationInDays } = req.body;
    if (!title || !description || goal === undefined) return res.status(400).json({ success: false, error: "title, description and goal required" });

    const goalWei = ethers.parseEther(goal.toString());
    const duration = BigInt(durationInDays ?? 30);

    const tx = await contract.createCampaign(title, description, goalWei, duration);
    await tx.wait();

    // read count and set campaignId
    const campaignCount = await contract.campaignCount();
    const campaignId = Number(campaignCount) - 1; // often campaignCount increments after creation

    // store metadata in MongoDB optionally
    try {
      await Campaign.create({
        title, description, targetEth: parseFloat(goal), creator: req.user, txHash: tx.hash, campaignId
      });
    } catch (dbErr) {
      // non-fatal
      console.warn("MongoDB save failed (optional):", dbErr.message);
    }

    res.json({ success: true, message: "Campaign created", txHash: tx.hash, campaignId });
  } catch (err) {
    res.status(500).json({ success: false, error: err?.shortMessage || err?.message || "Create failed" });
  }
};

export const donateToCampaign = async (req, res) => {
  const contract = req.app.locals.contract;
  if (!contract) return res.status(503).json({ success: false, error: "Blockchain not configured" });

  try {
    const { id, amount } = req.body;
    if (id === undefined || amount === undefined) return res.status(400).json({ error: "id and amount required" });

    const campaignId = BigInt(id);
    const value = ethers.parseEther(amount.toString());
    const tx = await contract.fund(campaignId, { value });
    await tx.wait();
    res.json({ success: true, message: "Donation successful", txHash: tx.hash });
  } catch (err) {
    res.status(500).json({ error: err?.shortMessage || err?.message || "Donation failed" });
  }
};

export const getCampaignFromBlockchain = async (req, res) => {
  const contract = req.app.locals.contract;
  if (!contract) return res.status(503).json({ error: "Blockchain not configured" });

  try {
    const id = Number(req.params.id);
    const total = Number(await contract.campaignCount());
    if (isNaN(id) || id < 0 || id >= total) return res.status(404).json({ error: "Not found" });

    // Use getCampaign() function instead of campaigns() mapping
    const result = await contract.getCampaign(BigInt(id));
    const [creator, title, description, goal, deadline, amountCollected] = result;
    const formatted = {
      id,
      creator: creator,
      title: title,
      description: description,
      goalEth: ethers.formatEther(goal),
      amountCollectedEth: ethers.formatEther(amountCollected),
      deadline: deadline.toString(),
    };
    res.json(formatted);
  } catch (err) {
    res.status(500).json({ error: "Could not fetch campaign: " + (err.message || err) });
  }
};

export const getAllBlockchainCampaigns = async (req, res) => {
  const contract = req.app.locals.contract;
  if (!contract) return res.status(503).json({ error: "Blockchain not configured" });

  try {
    // fetchAllCampaigns returns raw numbers as strings — caller may format
    const raw = await fetchAllCampaigns(contract);
    // convert wei strings to ETH using ethers.formatEther
    const formatted = raw.map((c) => {
      const goal = c.goal ? (typeof c.goal === "string" ? c.goal : c.goal.toString()) : "0";
      const collected = c.amountCollected ? c.amountCollected.toString() : "0";
      let goalEth = goal;
      let amountCollectedEth = collected;
      try {
        goalEth = ethers.formatEther(goal);
        amountCollectedEth = ethers.formatEther(collected);
      } catch (_) {}
      return {
        id: c.id,
        creator: c.creator,
        title: c.title,
        description: c.description,
        goal: goalEth,
        amountCollected: amountCollectedEth,
        deadline: c.deadline,
      };
    });
    res.json(formatted);
  } catch (err) {
    res.status(500).json({ error: "Could not fetch campaigns: " + (err.message || err) });
  }
};

// --- MongoDB metadata endpoints (admin/optional) ---
export const createCampaignInDB = async (req, res) => {
  try {
    const { title, description, targetEth, txHash, campaignId } = req.body;
    if (!title || !description) return res.status(400).json({ error: "title/description required" });

    const campaign = new Campaign({
      title,
      description,
      targetEth,
      txHash,
      campaignId,
      creator: req.user,
    });
    await campaign.save();
    res.json({ msg: "Campaign created (db)", campaign });
  } catch (err) {
    res.status(500).json({ error: err.message || "Server error" });
  }
};

export const getCampaignsFromDB = async (_req, res) => {
  try {
    const campaigns = await Campaign.find({ deleted: { $ne: true } }).populate("creator", "name email");
    res.json(campaigns);
  } catch (err) {
    res.status(500).json({ error: err.message || "Server error" });
  }
};

export const getCampaignByIdFromDB = async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id).populate("creator", "name email");
    if (!campaign) return res.status(404).json({ msg: "Not found" });
    res.json(campaign);
  } catch (err) {
    res.status(500).json({ error: err.message || "Server error" });
  }
};
