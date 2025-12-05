// utils/blockchain.js
/**
 * Helper to read all campaigns from the contract (v6 ethers style)
 * Uses getCampaign() function because struct has nested mapping
 */
export const fetchAllCampaigns = async (contract) => {
  if (!contract) throw new Error("Contract not provided");
  const countBn = await contract.campaignCount();
  const count = Number(countBn);
  const out = [];

  // Campaigns are 1-indexed (campaignCount increments before storing)
  for (let i = 1; i <= count; i++) {
    try {
      // Use getCampaign() function instead of campaigns() mapping
      const result = await contract.getCampaign(BigInt(i));
      const [creator, title, description, goal, deadline, amountCollected] = result;
      out.push({
        id: i,
        creator: creator,
        title: title,
        description: description,
        goal: goal.toString(),
        amountCollected: amountCollected.toString(),
        deadline: deadline ? deadline.toString() : null,
      });
    } catch (err) {
      // skip malformed
    }
  }

  // normalize numeric fields using contract utils (consumer can format with ethers.formatEther)
  return out.map((c) => ({
    id: c.id,
    creator: c.creator,
    title: c.title,
    description: c.description,
    goal: c.goal,
    amountCollected: c.amountCollected,
    deadline: c.deadline,
  }));
};
