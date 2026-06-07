import axios from 'axios';

const BASE_URL = 'http://localhost:3000';

const topupWallet = async (walletId: string, paymentId: string, amount: number) => {
  const response = await axios.post(`${BASE_URL}/wallets/${walletId}/topup`, { paymentId, amount });
  return response.data;
};

const deductWallet = async (walletId: string, paymentId: string, amount: number) => {
  const response = await axios.post(`${BASE_URL}/wallets/${walletId}/deduct`, { paymentId, amount });
  return response.data;
};

const walletId = '137726df-7de9-4c99-a223-e3c62689006a';

const requests = [
  () => topupWallet(walletId, 'mixed-topup-001', 500),
  () => deductWallet(walletId, 'mixed-deduct-001', 100),
  () => topupWallet(walletId, 'mixed-topup-002', 300),
  () => deductWallet(walletId, 'mixed-deduct-002', 200),
  () => topupWallet(walletId, 'mixed-topup-003', 400),
  () => deductWallet(walletId, 'mixed-deduct-003', 150),
];

Promise.allSettled(requests.map((req) => req()));
