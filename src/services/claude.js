async function analyzeSlip(imageBase64) {
  return {
    amount: 0,
    text: 'Claude Vision integration not configured yet',
    imageBase64,
  };
}

module.exports = {
  analyzeSlip,
};
