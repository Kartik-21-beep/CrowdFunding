import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../utils/api";
import CampaignCard from "../components/CampaignCard";

const MyCampaigns = () => {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadMyCampaigns = async () => {
    try {
      setLoading(true);
      const res = await api.get("/my-campaigns");
      setCampaigns(res.data);
    } catch (err) {
      setCampaigns([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMyCampaigns();
  }, []);

  // Listen for donation completion events
  useEffect(() => {
    const handleDonationComplete = () => {
      setTimeout(() => {
        loadMyCampaigns();
      }, 1500);
    };

    window.addEventListener("donation-complete", handleDonationComplete);
    return () => {
      window.removeEventListener("donation-complete", handleDonationComplete);
    };
  }, []);

  if (loading) {
    return (
      <div style={{ padding: "20px" }}>
        <p>Loading your campaigns...</p>
      </div>
    );
  }

  return (
    <div style={{ padding: "20px" }}>
      <h2>My Campaigns</h2>

      {campaigns.length === 0 ? (
        <p>
          You haven't created any campaigns yet.{" "}
          <Link to="/create" style={{ color: "#333", textDecoration: "underline" }}>
            Create one now!
          </Link>
        </p>
      ) : (
        <div style={{ display: "grid", gap: "20px", marginTop: "20px" }}>
          {campaigns.map((campaign) => (
            <CampaignCard key={campaign.id} campaign={campaign} />
          ))}
        </div>
      )}
    </div>
  );
};

export default MyCampaigns;

