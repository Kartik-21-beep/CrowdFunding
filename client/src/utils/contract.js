/**
 * Contract utility functions for blockchain interactions
 * 
 * IMPORTANT: Always uses MetaMask's BrowserProvider (window.ethereum)
 * Never uses JsonRpcProvider or localhost providers
 */
import { ethers } from "ethers";
import contractABI from "../abi/CrowdFund.json";

// Contract address - should be set via environment variable or config
const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS || "";

/**
 * Get contract instance with signer from MetaMask
 * This ensures transactions use the MetaMask account (with funds)
 */
export const getContract = async () => {
  if (!CONTRACT_ADDRESS) {
    throw new Error("Contract address not configured. Set VITE_CONTRACT_ADDRESS in .env");
  }
  
  if (!window.ethereum) {
    throw new Error("MetaMask is not installed. Please install MetaMask to continue.");
  }
  
  // Always use BrowserProvider from MetaMask
  const provider = new ethers.BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();
  
  return new ethers.Contract(CONTRACT_ADDRESS, contractABI.abi, signer);
};

/**
 * Get contract instance for read-only operations using MetaMask's BrowserProvider
 */
export const getContractReadOnly = async () => {
  if (!CONTRACT_ADDRESS) {
    throw new Error("Contract address not configured. Set VITE_CONTRACT_ADDRESS in .env");
  }
  
  if (!window.ethereum) {
    throw new Error("MetaMask is not installed. Please install MetaMask to continue.");
  }
  
  // Always use BrowserProvider from MetaMask (even for read-only)
  const provider = new ethers.BrowserProvider(window.ethereum);
  return new ethers.Contract(CONTRACT_ADDRESS, contractABI.abi, provider);
};

/**
 * Legacy function - kept for backward compatibility but now uses BrowserProvider
 * @deprecated Use getContract() instead - this always uses BrowserProvider now
 */
export const getContractWithSigner = async (signer) => {
  if (!CONTRACT_ADDRESS) {
    throw new Error("Contract address not configured. Set VITE_CONTRACT_ADDRESS in .env");
  }
  // Always use BrowserProvider - ignore passed signer to ensure MetaMask is used
  return getContract();
};

