// All monetary amounts in the app are stored in PAISE (₹1 = 100 paise).
export const rupees = (paise) => Math.round(Number(paise) || 0) / 100

/** Format paise as an Indian-rupee string, e.g. 199900 → "₹1,999". */
export const formatInr = (paise) => '₹' + rupees(paise).toLocaleString('en-IN')
