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

const wallets = [
  {
    walletId: '137726df-7de9-4c99-a223-e3c62689006a',
    requests: [
      () => topupWallet('137726df-7de9-4c99-a223-e3c62689006a', 'mixed-w1-topup-001', 500),
      () => deductWallet('137726df-7de9-4c99-a223-e3c62689006a', 'mixed-w1-deduct-001', 100),
      () => topupWallet('137726df-7de9-4c99-a223-e3c62689006a', 'mixed-w1-topup-002', 300),
      () => deductWallet('137726df-7de9-4c99-a223-e3c62689006a', 'mixed-w1-deduct-002', 200),
    ],
  },
  {
    walletId: '274320fb-dd8f-4c64-a505-42d31d22ebf6',
    requests: [
      () => topupWallet('274320fb-dd8f-4c64-a505-42d31d22ebf6', 'mixed-w2-topup-001', 400),
      () => deductWallet('274320fb-dd8f-4c64-a505-42d31d22ebf6', 'mixed-w2-deduct-001', 150),
      () => topupWallet('274320fb-dd8f-4c64-a505-42d31d22ebf6', 'mixed-w2-topup-002', 250),
      () => deductWallet('274320fb-dd8f-4c64-a505-42d31d22ebf6', 'mixed-w2-deduct-002', 100),
    ],
  },
  {
    walletId: '897b5df2-50e0-4eca-be76-06315e9b759c',
    requests: [
      () => topupWallet('897b5df2-50e0-4eca-be76-06315e9b759c', 'mixed-w3-topup-001', 600),
      () => deductWallet('897b5df2-50e0-4eca-be76-06315e9b759c', 'mixed-w3-deduct-001', 250),
      () => topupWallet('897b5df2-50e0-4eca-be76-06315e9b759c', 'mixed-w3-topup-002', 350),
      () => deductWallet('897b5df2-50e0-4eca-be76-06315e9b759c', 'mixed-w3-deduct-002', 300),
    ],
  },
];

const allRequests = wallets.flatMap(({ requests }) => requests.map((req) => req()));

Promise.allSettled(allRequests);
