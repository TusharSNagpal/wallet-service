import axios from 'axios';

const BASE_URL = 'http://localhost:3000';

const createWallet = async (userId: string) => {
  const response = await axios.post(`${BASE_URL}/wallets`, { userId });
  return response.data;
};

const userId = 'test-user-001';
createWallet(userId).catch((err) => {
  throw err;
});
