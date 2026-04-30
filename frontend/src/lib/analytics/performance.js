import { xirr } from './math';
import { toNumber } from './normalizers';

export const compoundReturns = (returns = []) => (
  returns.reduce((total, value) => total * (1 + toNumber(value)), 1) - 1
);

export const calculateTWR = (dailyReturns = []) => compoundReturns(dailyReturns);

export const calculateMWR = (cashFlowStream = []) => xirr(cashFlowStream);

export const calculateAverageUnitCost = (lots = []) => {
  const totals = lots.reduce((acc, lot) => {
    const quantity = toNumber(lot.quantity);
    const unitCost = toNumber(lot.unitCost ?? lot.unit_cost);
    const fee = toNumber(lot.fee);
    const tax = toNumber(lot.tax);
    return {
      quantity: acc.quantity + quantity,
      cost: acc.cost + (quantity * unitCost) + fee + tax
    };
  }, { quantity: 0, cost: 0 });
  if (totals.quantity <= 0) return 0;
  return totals.cost / totals.quantity;
};
