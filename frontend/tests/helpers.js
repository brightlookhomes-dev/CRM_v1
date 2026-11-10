// Mirrors the server formula: payment progress = verified received / agreed amount × 100.
export const paymentProgressFromApi = ({ totalReceived, totalAmount }) =>
  totalAmount > 0 ? Math.min(100, Math.round((totalReceived / totalAmount) * 10000) / 100) : 0;
