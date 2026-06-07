import axios from 'axios';

const BASE_URL = 'http://localhost:3000';

const deductWallet = async (walletId: string, paymentId: string, amount: number) => {
  const response = await axios.post(`${BASE_URL}/wallets/${walletId}/deduct`, { paymentId, amount });
  return response.data;
};

const wallets = [
  {
    walletId: '137726df-7de9-4c99-a223-e3c62689006a',
    requests: [
      { paymentId: 'deduct-w1-001', amount: 50 },
      { paymentId: 'deduct-w1-002', amount: 100 },
      { paymentId: 'deduct-w1-003', amount: 150 },
    ],
  },
  {
    walletId: '274320fb-dd8f-4c64-a505-42d31d22ebf6',
    requests: [
      { paymentId: 'deduct-w2-001', amount: 75 },
      { paymentId: 'deduct-w2-002', amount: 125 },
      { paymentId: 'deduct-w2-003', amount: 175 },
    ],
  },
  {
    walletId: '897b5df2-50e0-4eca-be76-06315e9b759c',
    requests: [
      { paymentId: 'deduct-w3-001', amount: 200 },
      { paymentId: 'deduct-w3-002', amount: 300 },
      { paymentId: 'deduct-w3-003', amount: 400 },
    ],
  },
];

const allRequests = wallets.flatMap(({ walletId, requests }) =>
  requests.map(({ paymentId, amount }) => deductWallet(walletId, paymentId, amount)),
);

Promise.allSettled(allRequests);
