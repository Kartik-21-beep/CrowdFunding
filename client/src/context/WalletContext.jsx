/**
 * WalletContext - MetaMask Integration
 * 
 * Enables users to connect their MetaMask wallet and make direct blockchain transactions.
 * This ensures real on-chain payments, full transparency, and immutable records.
 */
import { createContext, useContext, useState, useEffect } from "react";
import { ethers } from "ethers";

const WalletContext = createContext();

export const useWallet = () => useContext(WalletContext);

export const WalletProvider = ({ children }) => {
  const [account, setAccount] = useState(null);
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);

  // Check if MetaMask is installed
  const isMetaMaskInstalled = () => {
    return typeof window !== "undefined" && window.ethereum;
  };

  // Add Hardhat local network to MetaMask
  const addHardhatNetwork = async () => {
    try {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: "0x7A69", // 31337 in hex (Hardhat default)
          chainName: "Hardhat Local",
          nativeCurrency: {
            name: "ETH",
            symbol: "ETH",
            decimals: 18,
          },
          rpcUrls: ["http://127.0.0.1:8545"],
          blockExplorerUrls: null,
        }],
      });
      return true;
    } catch (error) {
      console.error("Error adding network:", error);
      if (error.code === 4902) {
        // Network already added, try to switch
        return await switchToHardhatNetwork();
      }
      return false;
    }
  };

  // Switch to Hardhat network
  const switchToHardhatNetwork = async () => {
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x7A69" }], // 31337 in hex
      });
      return true;
    } catch (error) {
      console.error("Error switching network:", error);
      return false;
    }
  };

  // Connect to MetaMask wallet
  const connectWallet = async () => {
    if (!isMetaMaskInstalled()) {
      alert("Please install MetaMask to use this feature!");
      window.open("https://metamask.io/download/", "_blank");
      return;
    }

    setIsConnecting(true);
    try {
      // Check current network and switch to Hardhat if needed
      const chainId = await window.ethereum.request({ method: "eth_chainId" });
      const hardhatChainId = "0x7A69"; // 31337 in hex
      
      if (chainId !== hardhatChainId) {
        const switched = await switchToHardhatNetwork();
        if (!switched) {
          // If switch failed, try adding the network
          const added = await addHardhatNetwork();
          if (!added) {
            alert("Please switch MetaMask to Hardhat Local network (Chain ID: 31337, RPC: http://127.0.0.1:8545)");
            setIsConnecting(false);
            return;
          }
        }
      }

      // Request account access
      const accounts = await window.ethereum.request({
        method: "eth_requestAccounts",
      });

      if (accounts.length > 0) {
        const provider = new ethers.BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        
        setAccount(accounts[0]);
        setProvider(provider);
        setSigner(signer);

        // Store account in localStorage
        localStorage.setItem("walletAccount", accounts[0]);
      }
    } catch (error) {
      console.error("Error connecting wallet:", error);
      if (error.code === 4001) {
        alert("Please connect to MetaMask.");
      } else {
        alert("Failed to connect wallet. Please try again.");
      }
    } finally {
      setIsConnecting(false);
    }
  };

  // Disconnect wallet
  const disconnectWallet = () => {
    setAccount(null);
    setProvider(null);
    setSigner(null);
    localStorage.removeItem("walletAccount");
  };

  // Check for existing connection on mount
  useEffect(() => {
    const checkConnection = async () => {
      if (isMetaMaskInstalled() && localStorage.getItem("walletAccount")) {
        try {
          // Use eth_requestAccounts instead of eth_accounts
          const accounts = await window.ethereum.request({
            method: "eth_requestAccounts",
          });
          
          if (accounts.length > 0 && accounts[0] === localStorage.getItem("walletAccount")) {
            const provider = new ethers.BrowserProvider(window.ethereum);
            const signer = await provider.getSigner();
            
            setAccount(accounts[0]);
            setProvider(provider);
            setSigner(signer);
          } else {
            localStorage.removeItem("walletAccount");
          }
        } catch (error) {
          console.error("Error checking wallet connection:", error);
          localStorage.removeItem("walletAccount");
        }
      }
    };

    checkConnection();

    // Listen for account changes - CORRECTED to update account state
    if (isMetaMaskInstalled()) {
      const handleAccountsChanged = async (accounts) => {
        if (accounts.length === 0) {
          disconnectWallet();
        } else {
          // Update account state
          setAccount(accounts[0]);
          localStorage.setItem("walletAccount", accounts[0]);
          
          // Refresh provider and signer for new account
          try {
            const provider = new ethers.BrowserProvider(window.ethereum);
            const signer = await provider.getSigner();
            setProvider(provider);
            setSigner(signer);
          } catch (err) {
            console.error("Error updating provider/signer:", err);
          }
        }
      };

      const handleChainChanged = () => {
        window.location.reload();
      };

      window.ethereum.on("accountsChanged", handleAccountsChanged);
      window.ethereum.on("chainChanged", handleChainChanged);

      // Cleanup event listeners on unmount
      return () => {
        if (window.ethereum) {
          window.ethereum.removeListener("accountsChanged", handleAccountsChanged);
          window.ethereum.removeListener("chainChanged", handleChainChanged);
        }
      };
    }
  }, []);

  return (
    <WalletContext.Provider
      value={{
        account,
        provider,
        signer,
        isConnecting,
        connectWallet,
        disconnectWallet,
        isMetaMaskInstalled: isMetaMaskInstalled(),
      }}
    >
      {children}
    </WalletContext.Provider>
  );
};

