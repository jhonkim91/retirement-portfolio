import React from 'react';
import { buildDataBadgeDescriptor } from '../lib/sourceRegistry';
import '../styles/DataBadge.css';

function DataBadge({ descriptor, source, asOf, freshnessClass, delayPolicy, citationText, note, code, compact = false }) {
  const badge = descriptor || buildDataBadgeDescriptor({
    source,
    asOf,
    freshnessClass,
    delayPolicy,
    citationText,
    note,
    code
  });

  return (
    <div className={`data-badge-row ${compact ? 'compact' : ''}`}>
      <span className="data-badge source">{badge.name}</span>
      <span className={`data-badge freshness ${badge.freshness.tone}`}>{badge.freshness.label}</span>
      {badge.asOfLabel && <span className="data-badge subtle">기준 {badge.asOfLabel}</span>}
      {badge.note && <span className="data-badge subtle">{badge.note}</span>}
    </div>
  );
}

export default DataBadge;
