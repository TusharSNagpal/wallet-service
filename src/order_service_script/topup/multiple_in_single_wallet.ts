import axios from 'axios';

const BASE_URL = 'http://localhost:3000';

const topupWallet = async (walletId: string, paymentId: string, amount: number) => {
  const response = await axios.post(`${BASE_URL}/wallets/${walletId}/topup`, { paymentId, amount });
  return response.data;
};

const walletId = 'df358c9c-744e-468b-a14c-d053c040562a';

const requests = [
  { paymentId: 'payment-001', amount: 100 },
  { paymentId: 'payment-002', amount: 200 },
  { paymentId: 'payment-003', amount: 300 },
  { paymentId: 'payment-004', amount: 400 },
  { paymentId: 'payment-005', amount: 500 },
];

Promise.allSettled(requests.map(({ paymentId, amount }) => topupWallet(walletId, paymentId, amount)));
