import { Link, useNavigate, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { useWallet } from "../context/WalletContext";

const Navbar = () => {
  const [user, setUser] = useState(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { account, connectWallet, disconnectWallet, isMetaMaskInstalled } = useWallet();

  useEffect(() => {
    const updateUser = () => {
      const userStr = localStorage.getItem("user");
      if (userStr) {
        try {
          setUser(JSON.parse(userStr));
        } catch (e) {
          setUser(null);
        }
      } else {
        setUser(null);
      }
    };

    updateUser();
    window.addEventListener("storage", updateUser);
    window.addEventListener("userLogin", updateUser);
    return () => {
      window.removeEventListener("storage", updateUser);
      window.removeEventListener("userLogin", updateUser);
    };
  }, [location.pathname]);

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setUser(null);
    navigate("/login");
  };

  return (
    <nav style={{ padding: "10px", background: "#222", color: "#fff", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <div>
        {user && (
          <>
            <Link to="/home" style={{ marginRight: "20px", color: "#fff", textDecoration: "none" }}>
              Home
            </Link>
            <Link to="/create" style={{ marginRight: "20px", color: "#fff", textDecoration: "none" }}>
              Create Campaign
            </Link>
            <Link to="/my-campaigns" style={{ marginRight: "20px", color: "#fff", textDecoration: "none" }}>
              My Campaigns
            </Link>
          </>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "15px" }}>
        {/* Wallet Connection */}
        {isMetaMaskInstalled && (
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            {account ? (
              <>
                <span style={{ fontSize: "12px", color: "#4CAF50" }}>
                  🦊 {account.slice(0, 6)}...{account.slice(-4)}
                </span>
                <button
                  onClick={disconnectWallet}
                  style={{
                    padding: "5px 10px",
                    cursor: "pointer",
                    background: "transparent",
                    border: "1px solid #fff",
                    color: "#fff",
                    fontSize: "12px"
                  }}
                >
                  Disconnect
                </button>
              </>
            ) : (
              <button
                onClick={connectWallet}
                style={{
                  padding: "5px 10px",
                  cursor: "pointer",
                  background: "#f57c00",
                  border: "none",
                  color: "#fff",
                  fontSize: "12px"
                }}
              >
                Connect Wallet
              </button>
            )}
          </div>
        )}

        {/* User Authentication */}
        {user ? (
          <>
            <span style={{ marginRight: "20px" }}>Hello, {user.name}</span>
            <button onClick={handleLogout} style={{ padding: "5px 15px", cursor: "pointer" }}>
              Logout
            </button>
          </>
        ) : (
          <>
            <Link to="/login" style={{ marginRight: "20px", color: "#fff", textDecoration: "none" }}>
              Login
            </Link>
            <Link to="/signup" style={{ color: "#fff", textDecoration: "none" }}>
              Sign Up
            </Link>
          </>
        )}
      </div>
    </nav>
  );
};

export default Navbar;
