import axios from 'axios';

const BASE_URL = 'http://localhost:3000';

const deductWallet = async (walletId: string, paymentId: string, amount: number) => {
  const response = await axios.post(`${BASE_URL}/wallets/${walletId}/deduct`, { paymentId, amount });
  return response.data;
};

const walletId = '137726df-7de9-4c99-a223-e3c62689006a';

const requests = [
  { paymentId: 'deduct-008', amount: 50 },
  { paymentId: 'deduct-002', amount: 100 },
  { paymentId: 'deduct-003', amount: 150 },
  { paymentId: 'deduct-004', amount: 200 },
  { paymentId: 'deduct-005', amount: 250 },
];

Promise.allSettled(requests.map(({ paymentId, amount }) => deductWallet(walletId, paymentId, amount)));
