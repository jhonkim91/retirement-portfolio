import React from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';

function ScreenerPriceChart({ series, formatCurrency }) {
  return (
    <ResponsiveContainer width="100%" height={360}>
      <LineChart data={series} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="date" minTickGap={28} />
        <YAxis tickFormatter={(value) => Number(value).toLocaleString('ko-KR')} width={82} />
        <Tooltip formatter={(value) => formatCurrency(value)} />
        <Line type="monotone" dataKey="price" name="종가" stroke="#17324d" strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="ma20" name="MA20" stroke="#33658a" strokeWidth={1.5} dot={false} />
        <Line type="monotone" dataKey="upper_bb" name="BB 상단" stroke="#d97706" strokeWidth={1.25} dot={false} strokeDasharray="5 4" />
        <Line type="monotone" dataKey="lower_bb" name="BB 하단" stroke="#0f766e" strokeWidth={1.25} dot={false} strokeDasharray="5 4" />
      </LineChart>
    </ResponsiveContainer>
  );
}

export default ScreenerPriceChart;
