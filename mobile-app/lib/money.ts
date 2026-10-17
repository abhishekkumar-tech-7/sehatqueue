// Amounts are stored and calculated in paise (100 paise = 1 rupee), on the server.
export function formatRupees(paise: number): string {
  const rupees = paise / 100;
  const hasPaise = paise % 100 !== 0;
  return (
    '\u20B9' +
    rupees.toLocaleString('en-IN', {
      minimumFractionDigits: hasPaise ? 2 : 0,
      maximumFractionDigits: 2,
    })
  );
}   