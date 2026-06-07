import axios from 'axios';

const BASE_URL = 'http://localhost:3000';

const topupWallet = async (walletId: string, paymentId: string, amount: number) => {
  const response = await axios.post(`${BASE_URL}/wallets/${walletId}/topup`, { paymentId, amount });
  return response.data;
};

const wallets = [
  {
    walletId: '137726df-7de9-4c99-a223-e3c62689006a',
    requests: [
      { paymentId: 'payment-w1-001', amount: 100 },
      { paymentId: 'payment-w1-002', amount: 200 },
      { paymentId: 'payment-w1-003', amount: 300 },
    ],
  },
  {
    walletId: '274320fb-dd8f-4c64-a505-42d31d22ebf6',
    requests: [
      { paymentId: 'payment-w2-001', amount: 150 },
      { paymentId: 'payment-w2-002', amount: 250 },
      { paymentId: 'payment-w2-003', amount: 350 },
    ],
  },
  {
    walletId: '897b5df2-50e0-4eca-be76-06315e9b759c',
    requests: [
      { paymentId: 'payment-w3-001', amount: 500 },
      { paymentId: 'payment-w3-002', amount: 600 },
      { paymentId: 'payment-w3-003', amount: 700 },
    ],
  },
];

const allRequests = wallets.flatMap(({ walletId, requests }) =>
  requests.map(({ paymentId, amount }) => topupWallet(walletId, paymentId, amount)),
);

Promise.allSettled(allRequests);
