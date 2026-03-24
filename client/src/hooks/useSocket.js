import { useSocket as useSocketContext } from '../context/SocketContext';

// Legacy hook wrapper for compatibility with existing components
export const useSocket = () => {
  return useSocketContext();
};
