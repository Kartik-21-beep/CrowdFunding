// index.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import { ethers } from "ethers";
import connectDB from "./config/db.js";
import authRoutes from "./routes/authRoutes.js";
import campaignRoutes from "./routes/campaignRoutes.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Connect to MongoDB
connectDB().catch((err) => {
  console.error("MongoDB connection failed:", err.message);
});

// Setup blockchain contract if env present
let contract = null;
if (process.env.RPC_URL && process.env.PRIVATE_KEY && process.env.CONTRACT_ADDRESS) {
  try {
    const abiPath = "./abi/CrowdFund.json";
    if (!fs.existsSync(abiPath)) {
      console.warn("⚠️ ABI file not found at ./abi/CrowdFund.json — blockchain routes will fail until ABI is provided.");
    } else {
      const abi = JSON.parse(fs.readFileSync(abiPath)).abi;
      const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
      const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
      contract = new ethers.Contract(process.env.CONTRACT_ADDRESS, abi, wallet);
      
      // Verify contract is deployed by checking code at address
      try {
        const code = await provider.getCode(process.env.CONTRACT_ADDRESS);
        if (code === "0x") {
          console.error("❌ No contract code found at address:", process.env.CONTRACT_ADDRESS);
          console.error("💡 Please deploy the contract first using: cd contracts && npx hardhat run scripts/deploy.cjs");
          contract = null;
        } else {
          // Try to call campaignCount to verify it works
          try {
            await contract.campaignCount();
          } catch (testErr) {
            console.error("❌ Contract exists but campaignCount() failed:", testErr.message);
            console.error("💡 The contract ABI might not match. Please redeploy and update CONTRACT_ADDRESS");
            contract = null;
          }
        }
      } catch (networkErr) {
        console.error("❌ Could not verify contract:", networkErr.message);
        contract = null;
      }
    }
  } catch (err) {
    console.error("❌ Blockchain init error:", err.message);
    console.error("Error stack:", err.stack);
  }
} else {
  console.log("⚠️ Blockchain env vars not set. Set RPC_URL, PRIVATE_KEY, CONTRACT_ADDRESS if you want blockchain features.");
  console.log("Current env vars:", {
    RPC_URL: process.env.RPC_URL ? "✅ Set" : "❌ Missing",
    PRIVATE_KEY: process.env.PRIVATE_KEY ? "✅ Set" : "❌ Missing",
    CONTRACT_ADDRESS: process.env.CONTRACT_ADDRESS ? "✅ Set" : "❌ Missing"
  });
}

// Attach contract to app locals for controllers to use
app.locals.contract = contract;

app.use("/auth", authRoutes);
// MongoDB routes are for admin/metadata only - NOT used by frontend
// Frontend MUST use blockchain endpoints below to prove Web3 usage
app.use("/campaign-db", campaignRoutes);

// ============================================================================
// BLOCKCHAIN ENDPOINTS - Source of Truth
// ============================================================================
// IMPORTANT: All campaign data displayed in the UI MUST come from blockchain.
// MongoDB is ONLY used for metadata (user ownership tracking, search, etc.)
// This ensures the project truly uses Web3/blockchain as immutable storage.
// ============================================================================

import auth from "./middleware/authMiddleware.js";

// Get all campaigns from blockchain (ONLY blockchain - no MongoDB)
app.get("/campaigns", async (req, res) => {
  if (!contract) {
    return res.json([]);
  }
  try {
    let totalBn;
    try {
      totalBn = await contract.campaignCount();
    } catch (countErr) {
      return res.json([]);
    }
    
    const total = Number(totalBn);
    
    if (isNaN(total) || total < 0 || total === 0) {
      return res.json([]);
    }
    
    const campaigns = [];
    
    // Campaigns are 1-indexed (campaignCount increments before storing)
    for (let i = 1; i <= total; i++) {
      try {
        // Use getCampaign() function - more reliable
        const result = await contract.getCampaign(BigInt(i));
        // getCampaign returns a tuple: [creator, title, description, goal, deadline, amountCollected]
        const [creator, title, description, goal, deadline, amountCollected] = result;
        
        campaigns.push({
          id: i,
          owner: creator,
          title: title || "Untitled Campaign",
          description: description || "No description",
          goal: ethers.formatEther(goal || 0n),
          deadline: deadline ? deadline.toString() : "0",
          raised: ethers.formatEther(amountCollected || 0n),
        });
      } catch (err) {
        // Skip if campaign doesn't exist - continue to next
      }
    }
    
    res.json(campaigns);
  } catch (err) {
    console.error("❌ Error fetching campaigns:", err.message);
    res.json([]);
  }
});

// Create campaign on blockchain (MongoDB metadata is optional)
app.post("/createCampaign", auth, async (req, res) => {
  if (!contract) {
    return res.status(503).json({ success: false, error: "Blockchain not configured" });
  }
  
  const { title, description, goal, durationInDays } = req.body;
  const userId = req.user;
  
  if (!title || !description || goal === undefined || goal === null) {
    return res.status(400).json({ success: false, error: "title, description and goal are required" });
  }
  
  try {
    const goalWei = ethers.parseEther(goal.toString());
    const duration = BigInt(durationInDays ?? 30);
    
    // Call createCampaign - this is a write transaction
    const tx = await contract.createCampaign(title, description, goalWei, duration);
    
    // Wait for transaction to be mined
    const receipt = await tx.wait();
    
    // Get campaign count after transaction is confirmed
    // Try to parse campaign ID from transaction events first, then fallback to campaignCount
    let campaignId;
    try {
      // Try to get campaign ID from CampaignCreated event
      const iface = contract.interface;
      const logs = receipt.logs;
      
      for (const log of logs) {
        try {
          const parsedLog = iface.parseLog(log);
          if (parsedLog && parsedLog.name === "CampaignCreated") {
            campaignId = Number(parsedLog.args.campaignId);
            break;
          }
        } catch (parseErr) {
          // Not a matching event, continue
        }
      }
      
      // If no event found, try reading campaignCount
      if (campaignId === undefined) {
        const campaignCount = await contract.campaignCount();
        campaignId = Number(campaignCount);
      }
    } catch (countErr) {
      console.error("Error reading campaignCount:", countErr.message);
      // If campaignCount fails, the transaction still succeeded
      // We'll use a temporary ID based on transaction hash
      campaignId = Math.floor(Math.random() * 1000000); // Temporary fallback
      console.warn(`Using temporary campaignId ${campaignId} for tx ${tx.hash}`);
    }
    
    // Store metadata in MongoDB (optional - for user ownership tracking only)
    // Campaign data itself is stored on blockchain above
    try {
      const mongoose = (await import("mongoose")).default;
      if (mongoose.connection.readyState === 1) {
        const Campaign = (await import("./models/Campaign.js")).default;
        await Campaign.create({
          title,
          description,
          targetEth: parseFloat(goal),
          raisedEth: 0, // Initialize raised amount to 0
          creator: userId,
          txHash: tx.hash,
          campaignId: campaignId,
        });
      }
    } catch (dbErr) {
      // MongoDB metadata storage failed - non-critical, campaign is on blockchain
    }
    
    res.json({ 
      success: true, 
      message: "Campaign created!", 
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      campaignId 
    });
  } catch (err) {
    console.error("Create campaign error:", err);
    const errorMessage = err?.reason || err?.shortMessage || err?.message || "Unknown error";
    res.status(500).json({ 
      success: false, 
      error: `Failed to create campaign: ${errorMessage}`,
      details: err.code ? `Error code: ${err.code}` : undefined
    });
  }
});

// Donate to campaign
app.post("/donate", async (req, res) => {
  if (!contract) {
    return res.status(503).json({ success: false, error: "Blockchain not configured" });
  }
  
  const { id, amount } = req.body;
  
  try {
    const campaignId = BigInt(id);
    const value = ethers.parseEther(amount.toString());
    
    // Execute donation on blockchain
    const tx = await contract.fund(campaignId, { value });
    await tx.wait();
    
    // Update MongoDB with latest raised amount from blockchain
    try {
      const mongoose = (await import("mongoose")).default;
      if (mongoose.connection.readyState === 1) {
        const Campaign = (await import("./models/Campaign.js")).default;
        // Fetch updated amount from blockchain using getCampaign
        const result = await contract.getCampaign(campaignId);
        const [, , , , , amountCollected] = result; // getCampaign returns tuple
        const raisedEth = parseFloat(ethers.formatEther(amountCollected));
        
        // Update MongoDB campaign metadata
        await Campaign.findOneAndUpdate(
          { campaignId: Number(id) },
          { raisedEth: raisedEth },
          { new: true }
        );
      }
    } catch (dbErr) {
      // MongoDB update failed - non-critical, donation succeeded on blockchain
    }
    
    res.json({ success: true, message: "Donation successful!", txHash: tx.hash });
  } catch (err) {
    res.status(500).json({ error: err?.shortMessage || err?.message });
  }
});

// Get single campaign from blockchain (ONLY blockchain - no MongoDB)
app.get("/campaign/:id", async (req, res) => {
  if (!contract) {
    return res.status(503).json({ error: "Blockchain not configured" });
  }
  try {
    const id = BigInt(req.params.id);
    const total = await contract.campaignCount();
    if (id > total) return res.status(404).json({ error: "Not found" });
    // Use getCampaign() function instead of campaigns() mapping
    const result = await contract.getCampaign(id);
    const [creator, title, description, goal, deadline, amountCollected] = result;
    const formatted = {
      id: Number(id),
      creator: creator,
      title: title,
      description: description,
      goalEth: ethers.formatEther(goal),
      amountCollectedEth: ethers.formatEther(amountCollected),
      deadline: deadline.toString(),
    };
    res.json(formatted);
  } catch (err) {
    res.status(500).json({ error: "Could not fetch campaign" });
  }
});

// Get campaigns created by logged-in user
// Returns campaigns from MongoDB only (user-specific ownership data)
app.get("/my-campaigns", auth, async (req, res) => {
  try {
    const userId = req.user;
    const mongoose = (await import("mongoose")).default;
    
    if (mongoose.connection.readyState !== 1) {
      // MongoDB not connected - return empty
      return res.json([]);
    }
    
    const Campaign = (await import("./models/Campaign.js")).default;
    const myCampaigns = await Campaign.find({ creator: userId, deleted: { $ne: true } })
      .select("-__v")
      .sort({ createdAt: -1 }); // Most recent first
    
    // Format MongoDB data to match frontend expectations
    const formattedCampaigns = myCampaigns.map(campaign => ({
      id: campaign.campaignId || campaign._id,
      title: campaign.title || "Untitled Campaign",
      description: campaign.description || "No description",
      goal: campaign.targetEth?.toString() || "0",
      raised: campaign.raisedEth?.toString() || "0", // Synced from blockchain after donations
      deadline: campaign.createdAt ? Math.floor(new Date(campaign.createdAt).getTime() / 1000).toString() : "0",
      txHash: campaign.txHash,
      createdAt: campaign.createdAt,
    }));
    
    res.json(formattedCampaigns);
  } catch (err) {
    res.status(500).json({ error: "Could not fetch your campaigns" });
  }
});

// Sync MongoDB after MetaMask donation (called by frontend after successful transaction)
// This ensures My Campaigns page shows updated progress bars
app.post("/sync-campaign", async (req, res) => {
  if (!contract) {
    return res.status(503).json({ success: false, error: "Blockchain not configured" });
  }

  try {
    const { campaignId } = req.body;
    
    if (!campaignId) {
      return res.status(400).json({ success: false, error: "campaignId is required" });
    }

    // Fetch updated amount from blockchain (source of truth) using getCampaign
    const result = await contract.getCampaign(BigInt(campaignId));
    const [, , , , , amountCollected] = result; // getCampaign returns tuple
    const raisedEth = parseFloat(ethers.formatEther(amountCollected));

    // Update MongoDB campaign metadata so My Campaigns shows correct progress
    const mongoose = (await import("mongoose")).default;
    if (mongoose.connection.readyState === 1) {
      const Campaign = (await import("./models/Campaign.js")).default;
      const updated = await Campaign.findOneAndUpdate(
        { campaignId: Number(campaignId) },
        { raisedEth: raisedEth },
        { new: true }
      );
      
      if (!updated) {
        // Campaign not found in MongoDB - might be from before MongoDB was connected
        // This is okay, campaign exists on blockchain
        return res.json({ success: true, raisedEth, warning: "Campaign not found in MongoDB metadata" });
      }
    } else {
      return res.json({ success: true, raisedEth, warning: "MongoDB not connected - sync skipped" });
    }

    res.json({ success: true, raisedEth });
  } catch (err) {
    res.status(500).json({ success: false, error: err?.message || "Sync failed" });
  }
});

app.get("/test", (_req, res) => res.json({ message: "Server running" }));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Backend running on http://localhost:${PORT}`));
