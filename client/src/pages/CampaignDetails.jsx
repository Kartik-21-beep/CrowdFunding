import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ethers } from "ethers";
import api from "../utils/api";
import { useWallet } from "../context/WalletContext";
import { getContract } from "../utils/contract";

const CampaignDetails = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { account, connectWallet, isMetaMaskInstalled } = useWallet();
  const [campaign, setCampaign] = useState(null);
  const [donationAmount, setDonationAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [donating, setDonating] = useState(false);
  const [error, setError] = useState("");
  const [chainId, setChainId] = useState(null);

  useEffect(() => {
    const fetchCampaign = async () => {
      try {
        const res = await api.get(`/campaign/${id}`);
        setCampaign(res.data);
      } catch (err) {
        setError("Campaign not found");
      }
    };

    fetchCampaign();

    // Check current network
    const checkNetwork = async () => {
      if (window.ethereum) {
        try {
          const id = await window.ethereum.request({ method: "eth_chainId" });
          setChainId(id);
        } catch (err) {
          console.error("Error checking network:", err);
        }
      }
    };

    checkNetwork();

    // Listen for network changes
    if (window.ethereum) {
      window.ethereum.on("chainChanged", (newChainId) => {
        setChainId(newChainId);
        window.location.reload();
      });
    }
  }, [id]);

  const handleDonate = async (e) => {
    e.preventDefault();
    
    // Check if MetaMask is installed
    if (!isMetaMaskInstalled) {
      setError("Please install MetaMask to donate");
      window.open("https://metamask.io/download/", "_blank");
      return;
    }

    // Check if wallet is connected
    if (!account) {
      setError("Please connect your MetaMask wallet first");
      await connectWallet();
      return;
    }

    // Verify we're on the correct network (Hardhat Local - Chain ID 31337)
    try {
      const chainId = await window.ethereum.request({ method: "eth_chainId" });
      const hardhatChainId = "0x7A69"; // 31337 in hex
      
      if (chainId !== hardhatChainId) {
        setError("Please switch MetaMask to Hardhat Local network (Chain ID: 31337)");
        // Try to switch automatically
        try {
          await window.ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: hardhatChainId }],
          });
        } catch (switchError) {
          if (switchError.code === 4902) {
            // Network not added, try to add it
            try {
              await window.ethereum.request({
                method: "wallet_addEthereumChain",
                params: [{
                  chainId: hardhatChainId,
                  chainName: "Hardhat Local",
                  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
                  rpcUrls: ["http://127.0.0.1:8545"],
                }],
              });
            } catch (addError) {
              setError("Please add Hardhat network to MetaMask: Chain ID 31337, RPC: http://127.0.0.1:8545");
              setDonating(false);
              return;
            }
          } else {
            setError("Please switch to Hardhat Local network in MetaMask");
            setDonating(false);
            return;
          }
        }
      }
    } catch (networkError) {
      console.error("Network check error:", networkError);
    }

    if (!donationAmount || parseFloat(donationAmount) <= 0) {
      setError("Please enter a valid donation amount");
      return;
    }

    setDonating(true);
    setError("");

    try {
      // Get contract instance using MetaMask's BrowserProvider
      // This ensures we use the MetaMask account (with funds) instead of Hardhat account
      // getContract() internally creates: new ethers.BrowserProvider(window.ethereum)
      const contract = await getContract();
      const campaignId = BigInt(id);
      const value = ethers.parseEther(donationAmount.toString());

      // Show user-friendly message about MetaMask popup
      setError("");
      // Note: MetaMask popup will appear - this is REQUIRED for security
      // The popup allows users to review and confirm the transaction
      
      // Execute donation transaction directly from user's MetaMask wallet
      // IMPORTANT: MetaMask popup will appear - this is REQUIRED for security
      // The popup cannot be bypassed as it protects users from unauthorized transactions
      const tx = await contract.fund(campaignId, { value });
      
      // Transaction submitted successfully - user confirmed in MetaMask popup
      // Show transaction hash immediately
      setError(""); // Clear any previous errors
      
      // Wait for transaction confirmation on blockchain
      await tx.wait();

      // Sync MongoDB with updated raised amount AFTER transaction is confirmed
      // This ensures My Campaigns page shows updated progress bar
      try {
        const syncRes = await api.post("/sync-campaign", {
          campaignId: parseInt(id),
        });
        if (syncRes.data.success) {
          console.log("✅ MongoDB synced. Updated raised amount:", syncRes.data.raisedEth);
        }
      } catch (syncErr) {
        // MongoDB sync failed - non-critical, transaction succeeded on blockchain
        // But My Campaigns progress bar won't update until next sync
        console.warn("⚠️ MongoDB sync failed:", syncErr);
        // Retry sync after a short delay
        setTimeout(async () => {
          try {
            await api.post("/sync-campaign", { campaignId: parseInt(id) });
            console.log("✅ MongoDB sync retry successful");
          } catch (retryErr) {
            console.warn("⚠️ MongoDB sync retry failed:", retryErr);
          }
        }, 2000);
      }

      alert(`Donation successful! Tx Hash: ${tx.hash}`);
      
      // Refresh campaign data from blockchain
      const updated = await api.get(`/campaign/${id}`);
      setCampaign(updated.data);
      setDonationAmount("");
    } catch (err) {
      console.error("Donation error:", err);
      if (err.code === 4001) {
        setError("Transaction rejected by user");
      } else if (err.code === "INSUFFICIENT_FUNDS" || err.message?.includes("insufficient funds")) {
        setError("Insufficient funds. Make sure MetaMask is connected to Hardhat Local network (Chain ID: 31337) where your account has 10,000 ETH.");
      } else if (err.reason) {
        setError(err.reason);
      } else {
        const errorMsg = err?.message || "Donation failed. Please try again.";
        if (errorMsg.includes("insufficient funds")) {
          setError("Insufficient funds. Please switch MetaMask to Hardhat Local network (Chain ID: 31337).");
        } else {
          setError(errorMsg);
        }
      }
    } finally {
      setDonating(false);
    }
  };

  if (loading) {
    return <div style={{ padding: "20px" }}>Loading...</div>;
  }

  if (error && !campaign) {
    return (
      <div style={{ padding: "20px" }}>
        <p>{error}</p>
        <button onClick={() => navigate("/")}>Go Back</button>
      </div>
    );
  }

  if (!campaign) {
    return <div style={{ padding: "20px" }}>Loading campaign...</div>;
  }

  const progress = campaign.goalEth > 0 
    ? (parseFloat(campaign.amountCollectedEth) / parseFloat(campaign.goalEth)) * 100 
    : 0;

  return (
    <div style={{ padding: "20px", maxWidth: "800px", margin: "0 auto" }}>
      <button onClick={() => navigate("/home")} style={{ marginBottom: "20px" }}>
        ← Back to Home
      </button>

      <h1>{campaign.title || "Untitled Campaign"}</h1>
      <p style={{ fontSize: "16px", marginBottom: "20px" }}>
        {campaign.description || "No description"}
      </p>

      <div style={{ border: "1px solid #ccc", padding: "20px", borderRadius: "8px", marginBottom: "20px" }}>
        <h3>Campaign Details</h3>
        <p><strong>Creator:</strong> {campaign.creator}</p>
        <p><strong>Goal:</strong> {campaign.goalEth} ETH</p>
        <p><strong>Raised:</strong> {campaign.amountCollectedEth} ETH</p>
        <p><strong>Progress:</strong> {progress.toFixed(2)}%</p>
        
        <div style={{ 
          width: "100%", 
          height: "20px", 
          background: "#f0f0f0", 
          borderRadius: "10px", 
          marginTop: "10px",
          overflow: "hidden"
        }}>
          <div style={{
            width: `${Math.min(progress, 100)}%`,
            height: "100%",
            background: "#4CAF50",
            transition: "width 0.3s"
          }}></div>
        </div>

        {campaign.deadline && (
          <p style={{ marginTop: "10px" }}>
            <strong>Deadline:</strong> {new Date(parseInt(campaign.deadline) * 1000).toLocaleDateString()}
          </p>
        )}
      </div>

      <div style={{ border: "1px solid #ccc", padding: "20px", borderRadius: "8px" }}>
        <h3>Make a Donation</h3>
        <p style={{ fontSize: "14px", color: "#666", marginBottom: "15px" }}>
          Connect your MetaMask wallet to donate directly on-chain. All donations are transparent and immutable.
        </p>
        
        {!isMetaMaskInstalled && (
          <div style={{ background: "#fff3cd", padding: "10px", borderRadius: "4px", marginBottom: "15px" }}>
            <p style={{ margin: 0, color: "#856404" }}>
              MetaMask is not installed.{" "}
              <a href="https://metamask.io/download/" target="_blank" rel="noopener noreferrer" style={{ color: "#856404" }}>
                Install MetaMask
              </a>
            </p>
          </div>
        )}

        {!account && isMetaMaskInstalled && (
          <div style={{ background: "#d1ecf1", padding: "10px", borderRadius: "4px", marginBottom: "15px" }}>
            <p style={{ margin: 0, color: "#0c5460" }}>
              Please connect your wallet to donate.
            </p>
          </div>
        )}

        {account && (
          <div style={{ background: chainId === "0x7A69" ? "#d4edda" : "#fff3cd", padding: "10px", borderRadius: "4px", marginBottom: "15px" }}>
            <p style={{ margin: 0, color: chainId === "0x7A69" ? "#155724" : "#856404" }}>
              Connected: {account.slice(0, 6)}...{account.slice(-4)}
            </p>
            {chainId === "0x7A69" && (
              <p style={{ margin: "5px 0 0 0", fontSize: "12px", color: "#155724" }}>
                ✅ Connected to Hardhat Local network - Ready to donate!
              </p>
            )}
          </div>
        )}
        
        {error && (
          <div style={{ color: "red", marginBottom: "10px", padding: "10px", background: "#ffebee", borderRadius: "4px" }}>{error}</div>
        )}

        <form onSubmit={handleDonate} style={{ display: "flex", flexDirection: "column", maxWidth: "400px" }}>
          <input
            type="number"
            step="0.001"
            placeholder="Amount (ETH)"
            value={donationAmount}
            onChange={(e) => setDonationAmount(e.target.value)}
            required
            disabled={!account || donating}
            style={{ marginBottom: 10, padding: 8 }}
          />

          {!account ? (
            <button
              type="button"
              onClick={connectWallet}
              style={{ padding: 10, background: "#f57c00", color: "#fff", cursor: "pointer", border: "none", borderRadius: "4px" }}
            >
              Connect MetaMask Wallet
            </button>
          ) : (
            <button
              type="submit"
              disabled={donating}
              style={{ 
                padding: 12, 
                background: donating ? "#999" : "#4CAF50", 
                color: "#fff", 
                cursor: donating ? "not-allowed" : "pointer", 
                border: "none", 
                borderRadius: "4px",
                fontSize: "16px",
                fontWeight: "bold"
              }}
            >
              {donating ? "Confirm in MetaMask..." : "Donate with MetaMask"}
            </button>
          )}
          
          
          {donating && (
            <div style={{ marginTop: "15px", padding: "12px", background: "#e3f2fd", borderRadius: "4px", border: "1px solid #90caf9" }}>
              <p style={{ margin: 0, fontSize: "14px", color: "#1976d2", fontWeight: "500" }}>
                ⏳ Transaction in progress...
              </p>
            </div>
          )}
        </form>
      </div>
    </div>
  );
};

export default CampaignDetails;

