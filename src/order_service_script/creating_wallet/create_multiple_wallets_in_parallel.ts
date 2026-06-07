import axios from 'axios';

const BASE_URL = 'http://localhost:3000';

const createWallet = async (userId: string) => {
  const response = await axios.post(`${BASE_URL}/wallets`, { userId });
  return response.data;
};

const userIds = [
  'test-user-001',
  'test-user-002',
  'test-user-003',
  'test-user-004',
  'test-user-005',
];

Promise.allSettled(userIds.map((userId) => createWallet(userId)));
