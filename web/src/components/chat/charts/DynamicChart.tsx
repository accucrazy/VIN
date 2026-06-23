/**
 * DynamicChart Component
 * 
 * AI 動態選擇圖表類型
 * Layer 3: 智慧推斷欄位 + TableFallback 保底機制
 */

'use client';

import React from 'react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  ComposedChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { BarChart3 } from 'lucide-react';
import { CustomTooltip } from './CustomTooltip';
import { CHART_COLORS } from './colors';
import type { ChartConfig } from './types';

export interface DynamicChartProps {
  config: ChartConfig;
  data: any[];
}

interface InferredFields {
  xKey: string;
  valueKeys: string[];
}

/**
 * Classify all fields in the data into category fields (strings/labels)
 * and numeric fields (numbers or parseable numeric strings).
 */
function classifyFields(data: any[]): { categoryFields: string[]; numericFields: string[] } {
  if (!data || data.length === 0) return { categoryFields: [], numericFields: [] };

  const fields = Object.keys(data[0]);
  const categoryFields: string[] = [];
  const numericFields: string[] = [];

  for (const f of fields) {
    let numericCount = 0;
    let stringCount = 0;
    const sampleSize = Math.min(data.length, 10);

    for (let i = 0; i < sampleSize; i++) {
      const val = data[i][f];
      if (val === null || val === undefined) continue;
      if (typeof val === 'number') {
        numericCount++;
      } else if (typeof val === 'string') {
        if (val !== '' && !isNaN(Number(val))) {
          numericCount++;
        } else {
          stringCount++;
        }
      }
    }

    if (numericCount > stringCount) {
      numericFields.push(f);
    } else {
      categoryFields.push(f);
    }
  }

  return { categoryFields, numericFields };
}

/**
 * Try to find a matching field in the data for an expected key.
 * Uses exact match (case-insensitive), then partial/substring match.
 */
function findFieldMatch(fields: string[], expectedKey: string): string | null {
  const lower = expectedKey.toLowerCase();
  const exact = fields.find(f => f.toLowerCase() === lower);
  if (exact) return exact;

  const partial = fields.find(f =>
    f.toLowerCase().includes(lower) || lower.includes(f.toLowerCase())
  );
  return partial || null;
}

/**
 * Intelligently infer chart X/Y fields from actual data structure.
 * Priority: use config-specified fields if they exist in data, otherwise auto-detect.
 */
function inferChartFields(data: any[], config: ChartConfig): InferredFields | null {
  if (!data || data.length === 0) return null;

  const availableFields = Object.keys(data[0]);
  const { categoryFields, numericFields } = classifyFields(data);

  if (categoryFields.length === 0 && numericFields.length === 0) return null;

  // Resolve xKey: prefer config value if it exists in data
  let xKey: string | null = null;
  if (config.xAxis?.dataKey && availableFields.includes(config.xAxis.dataKey)) {
    xKey = config.xAxis.dataKey;
  } else if (config.xAxis?.dataKey) {
    xKey = findFieldMatch(availableFields, config.xAxis.dataKey);
  }
  if (!xKey && categoryFields.length > 0) {
    xKey = categoryFields[0];
  }
  if (!xKey) return null;

  // Resolve valueKeys: try each dataset's dataKey
  const valueKeys: string[] = [];
  for (const ds of config.datasets) {
    if (availableFields.includes(ds.dataKey)) {
      valueKeys.push(ds.dataKey);
    } else {
      const match = findFieldMatch(numericFields, ds.dataKey);
      if (match && !valueKeys.includes(match)) {
        valueKeys.push(match);
      }
    }
  }

  // If no dataset keys matched, pick numeric fields by position
  if (valueKeys.length === 0) {
    const usableNumeric = numericFields.filter(f => f !== xKey);
    if (usableNumeric.length > 0) {
      valueKeys.push(...usableNumeric.slice(0, config.datasets.length || 1));
    }
  }

  if (valueKeys.length === 0) return null;

  return { xKey, valueKeys };
}

/**
 * Build a usable ChartConfig from inferred fields, preserving labels/colors/types.
 */
function buildResolvedConfig(config: ChartConfig, inferred: InferredFields): ChartConfig {
  return {
    ...config,
    xAxis: { ...config.xAxis, dataKey: inferred.xKey },
    datasets: config.datasets.map((ds, i) => ({
      ...ds,
      dataKey: inferred.valueKeys[i] ?? inferred.valueKeys[0],
    })),
  };
}

/**
 * Detect if datasets have significantly different value ranges.
 * Returns true if the max values differ by more than the threshold ratio.
 * This indicates a dual Y-axis should be used.
 */
function detectScaleDifference(data: any[], valueKeys: string[], threshold = 5): { needsDualAxis: boolean; leftKeys: string[]; rightKeys: string[] } {
  if (!data || data.length === 0 || valueKeys.length < 2) {
    return { needsDualAxis: false, leftKeys: valueKeys, rightKeys: [] };
  }

  const toNum = (v: any): number => {
    if (typeof v === 'number') return v;
    const n = parseFloat(v);
    return isNaN(n) ? 0 : n;
  };

  // Calculate max values for each key
  const maxValues: { key: string; max: number }[] = valueKeys.map(key => {
    const max = Math.max(...data.map(row => Math.abs(toNum(row[key]))));
    return { key, max };
  });

  // Sort by max value descending
  maxValues.sort((a, b) => b.max - a.max);

  // Check if the largest differs significantly from the smallest
  const largest = maxValues[0]?.max || 1;
  const smallest = maxValues[maxValues.length - 1]?.max || 1;
  const ratio = largest / Math.max(smallest, 0.001);

  if (ratio >= threshold) {
    // Split: larger values on left axis, smaller on right
    const midIndex = Math.ceil(maxValues.length / 2);
    const leftKeys = maxValues.slice(0, midIndex).map(v => v.key);
    const rightKeys = maxValues.slice(midIndex).map(v => v.key);
    
    console.log(`[DynamicChart] Dual Y-axis detected: ratio=${ratio.toFixed(1)}x (threshold: ${threshold}x)`);
    console.log(`[DynamicChart] Left axis: [${leftKeys.join(', ')}], Right axis: [${rightKeys.join(', ')}]`);
    
    return { needsDualAxis: true, leftKeys, rightKeys };
  }

  return { needsDualAxis: false, leftKeys: valueKeys, rightKeys: [] };
}

/**
 * SvgChartFallback: inline SVG chart rendered when Recharts can't display the data.
 * Supports bar, pie, line/area as basic SVG. This is the absolute last resort.
 */
function SvgChartFallback({ data, config }: { data: any[]; config: ChartConfig }) {
  if (!data || data.length === 0) return null;

  const fields = Object.keys(data[0]);
  const numericFields = fields.filter(f => {
    const v = data[0][f];
    return typeof v === 'number' || (typeof v === 'string' && v !== '' && !isNaN(Number(v)));
  });
  const categoryFields = fields.filter(f => !numericFields.includes(f));

  const xKey = categoryFields[0] || fields[0];
  const valueKeys = numericFields.length > 0
    ? numericFields.slice(0, config.datasets?.length || 1)
    : [fields.find(f => f !== xKey) || fields[0]];

  const toNum = (v: any): number => {
    if (typeof v === 'number') return v;
    const n = parseFloat(v);
    return isNaN(n) ? 0 : n;
  };

  const svgW = 600;
  const svgH = 340;
  const pad = { top: 20, right: 20, bottom: 50, left: 55 };
  const cW = svgW - pad.left - pad.right;
  const cH = svgH - pad.top - pad.bottom;

  const isPie = config.type === 'pie';
  const isLine = config.type === 'line' || config.type === 'multi-line' || config.type === 'area';

  const renderBarChart = () => {
    const allVals = data.flatMap(r => valueKeys.map(k => toNum(r[k])));
    const maxVal = Math.max(...allVals, 1);
    const groupW = cW / data.length;
    const barW = Math.max(4, (groupW * 0.7) / valueKeys.length);
    const gPad = (groupW - barW * valueKeys.length) / 2;

    return (
      <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full h-auto">
        {/* Grid lines */}
        {Array.from({ length: 5 }).map((_, i) => {
          const y = pad.top + cH - (((i + 1) / 5) * cH);
          return <line key={i} x1={pad.left} y1={y} x2={svgW - pad.right} y2={y} stroke="#e5e7eb" strokeDasharray="3 3" />;
        })}
        {/* Bars */}
        {data.map((row, ri) => valueKeys.map((vk, vi) => {
          const val = toNum(row[vk]);
          const bH = (val / maxVal) * cH;
          const x = pad.left + ri * groupW + gPad + vi * barW;
          const y = pad.top + cH - bH;
          return <rect key={`${ri}-${vi}`} x={x} y={y} width={barW - 1} height={bH} fill={CHART_COLORS[vi % CHART_COLORS.length]} rx={2} />;
        }))}
        {/* X labels */}
        {data.map((row, ri) => (
          <text key={ri} x={pad.left + ri * groupW + groupW / 2} y={svgH - 8} textAnchor="middle" fontSize={10} fill="#6b7280">{String(row[xKey] ?? '').slice(0, 10)}</text>
        ))}
        {/* Legend */}
        {valueKeys.map((vk, i) => (
          <g key={i}>
            <rect x={pad.left + i * 120} y={svgH - 30} width={10} height={10} fill={CHART_COLORS[i % CHART_COLORS.length]} rx={2} />
            <text x={pad.left + i * 120 + 14} y={svgH - 21} fontSize={10} fill="#374151">{config.datasets[i]?.label || vk}</text>
          </g>
        ))}
      </svg>
    );
  };

  const renderPieChart = () => {
    const vk = valueKeys[0];
    const total = data.reduce((s, r) => s + toNum(r[vk]), 0) || 1;
    const cx = svgW / 2;
    const cy = svgH / 2 - 10;
    const radius = Math.min(cx, cy) - 40;
    let startAngle = -Math.PI / 2;

    const slices = data.map((row, i) => {
      const val = toNum(row[vk]);
      const pct = val / total;
      const angle = pct * 2 * Math.PI;
      const endAngle = startAngle + angle;
      const largeArc = angle > Math.PI ? 1 : 0;
      const x1 = cx + radius * Math.cos(startAngle);
      const y1 = cy + radius * Math.sin(startAngle);
      const x2 = cx + radius * Math.cos(endAngle);
      const y2 = cy + radius * Math.sin(endAngle);
      const d = `M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`;
      const midAngle = startAngle + angle / 2;
      const lx = cx + (radius + 18) * Math.cos(midAngle);
      const ly = cy + (radius + 18) * Math.sin(midAngle);
      startAngle = endAngle;
      return (
        <g key={i}>
          <path d={d} fill={CHART_COLORS[i % CHART_COLORS.length]} />
          {pct > 0.03 && <text x={lx} y={ly} textAnchor="middle" fontSize={10} fill="#374151">{(pct * 100).toFixed(1)}%</text>}
        </g>
      );
    });

    return (
      <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full h-auto">
        {slices}
        {data.map((row, i) => (
          <g key={i}>
            <rect x={20 + (i % 3) * (svgW / 3)} y={svgH - 22} width={10} height={10} fill={CHART_COLORS[i % CHART_COLORS.length]} rx={2} />
            <text x={34 + (i % 3) * (svgW / 3)} y={svgH - 13} fontSize={10} fill="#374151">{String(row[xKey]).slice(0, 12)}</text>
          </g>
        ))}
      </svg>
    );
  };

  const renderLineChart = () => {
    const allVals = data.flatMap(r => valueKeys.map(k => toNum(r[k])));
    const maxV = Math.max(...allVals, 1);
    const minV = Math.min(...allVals, 0);
    const range = maxV - minV || 1;

    return (
      <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full h-auto">
        {Array.from({ length: 5 }).map((_, i) => {
          const y = pad.top + cH - (((i + 1) / 5) * cH);
          return <line key={i} x1={pad.left} y1={y} x2={svgW - pad.right} y2={y} stroke="#e5e7eb" strokeDasharray="3 3" />;
        })}
        {valueKeys.map((vk, vi) => {
          const pts = data.map((row, ri) => {
            const x = pad.left + (ri / Math.max(data.length - 1, 1)) * cW;
            const y = pad.top + cH - ((toNum(row[vk]) - minV) / range) * cH;
            return `${x},${y}`;
          }).join(' ');
          return <polyline key={vi} points={pts} fill="none" stroke={CHART_COLORS[vi % CHART_COLORS.length]} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />;
        })}
        {data.map((row, ri) => {
          const step = Math.max(1, Math.floor(data.length / 8));
          if (ri % step !== 0 && ri !== data.length - 1) return null;
          const x = pad.left + (ri / Math.max(data.length - 1, 1)) * cW;
          return <text key={ri} x={x} y={svgH - 8} textAnchor="middle" fontSize={10} fill="#6b7280">{String(row[xKey]).slice(0, 10)}</text>;
        })}
        {valueKeys.map((vk, i) => (
          <g key={i}>
            <line x1={pad.left + i * 120} y1={svgH - 25} x2={pad.left + i * 120 + 16} y2={svgH - 25} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2.5} />
            <text x={pad.left + i * 120 + 20} y={svgH - 21} fontSize={10} fill="#374151">{config.datasets[i]?.label || vk}</text>
          </g>
        ))}
      </svg>
    );
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 mt-4">
      <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2 mb-4">
        <BarChart3 className="w-5 h-5 text-indigo-600" />
        {config.title}
      </h3>
      {config.description && (
        <p className="text-sm text-gray-500 mb-4">{config.description}</p>
      )}
      <div style={{ width: '100%' }}>
        {isPie ? renderPieChart() : isLine ? renderLineChart() : renderBarChart()}
      </div>
    </div>
  );
}

export const DynamicChart = ({ 
  config, 
  data: propsData 
}: DynamicChartProps) => {
  // Priority: use config.data (bound snapshot) if available, otherwise use props data
  // This ensures each chart uses its correct data source in A2A scenarios
  const data = React.useMemo(() => {
    const configData = (config as any).data;
    if (configData && Array.isArray(configData) && configData.length > 0) {
      console.log(`[DynamicChart] Using bound data snapshot (${configData.length} rows) for "${config.title}"`);
      return configData;
    }
    return propsData;
  }, [config, propsData]);

  // Layer 3: Infer fields from actual data structure
  const inferred = React.useMemo(() => inferChartFields(data, config), [data, config]);

  // Build resolved config with correct dataKeys
  const resolvedConfig = React.useMemo(() => {
    if (!inferred) return null;
    return buildResolvedConfig(config, inferred);
  }, [config, inferred]);

  // Infer chart type
  const chartType = React.useMemo(() => {
    const cfg = resolvedConfig || config;
    if (cfg.type) return cfg.type;
    const datasetWithType = cfg.datasets?.find(ds => ds.type);
    if (datasetWithType?.type) return datasetWithType.type;
    return 'bar';
  }, [resolvedConfig, config]);

  // Detect if dual Y-axis is needed for composed charts
  const dualAxisInfo = React.useMemo(() => {
    if (chartType !== 'composed' || !inferred || inferred.valueKeys.length < 2) {
      return { needsDualAxis: false, leftKeys: inferred?.valueKeys || [], rightKeys: [] };
    }
    return detectScaleDifference(data, inferred.valueKeys, 5);
  }, [chartType, data, inferred]);

  // If we couldn't infer valid fields, fall back to inline SVG chart
  if (!resolvedConfig) {
    console.warn(`[DynamicChart] Cannot infer fields for "${config.title}", falling back to SVG`);
    return <SvgChartFallback data={data} config={config} />;
  }

  const rc = resolvedConfig;

  const getChartComponent = () => {
    switch (chartType) {
      case 'line':
        return (
          <LineChart data={data} margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey={rc.xAxis.dataKey} tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip content={<CustomTooltip />} />
            <Legend />
            {rc.datasets.map((ds, idx) => (
              <Line
                key={idx}
                type="monotone"
                dataKey={ds.dataKey}
                stroke={ds.color || CHART_COLORS[idx]}
                name={ds.label}
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            ))}
          </LineChart>
        );
      
      case 'bar':
        return (
          <BarChart data={data} margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey={rc.xAxis.dataKey} tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip content={<CustomTooltip />} />
            <Legend />
            {rc.datasets.map((ds, idx) => (
              <Bar
                key={idx}
                dataKey={ds.dataKey}
                fill={ds.color || CHART_COLORS[idx]}
                name={ds.label}
              />
            ))}
          </BarChart>
        );
      
      case 'area':
        return (
          <ComposedChart data={data} margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
            <defs>
              {rc.datasets.map((ds, idx) => (
                <linearGradient key={idx} id={`gradient-${idx}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={ds.color || CHART_COLORS[idx]} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={ds.color || CHART_COLORS[idx]} stopOpacity={0.05} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey={rc.xAxis.dataKey} tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip content={<CustomTooltip />} />
            <Legend />
            {rc.datasets.map((ds, idx) => (
              <Area
                key={idx}
                type="monotone"
                dataKey={ds.dataKey}
                stroke={ds.color || CHART_COLORS[idx]}
                fill={`url(#gradient-${idx})`}
                name={ds.label}
                isAnimationActive={false}
              />
            ))}
          </ComposedChart>
        );
      
      case 'pie': {
        const nameKey = rc.xAxis?.dataKey || 'name';
        const valueKey = rc.datasets?.[0]?.dataKey || 'value';
        
        const legendPayload = data.map((item: any, idx: number) => ({
          value: item[nameKey] || `Item ${idx + 1}`,
          type: 'square' as const,
          color: CHART_COLORS[idx % CHART_COLORS.length],
        }));

        return (
          <PieChart>
            <Pie
              data={data}
              dataKey={valueKey}
              nameKey={nameKey}
              cx="50%"
              cy="50%"
              outerRadius={100}
              label={(props: any) => {
                const { name, percent } = props;
                return `${name} ${((percent || 0) * 100).toFixed(1)}%`;
              }}
              labelLine={true}
            >
              {data.map((_: any, idx: number) => (
                <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              formatter={((value: number, name: string) => [
                typeof value === 'number' ? `${value.toFixed(1)}%` : value,
                name,
              ]) as any}
            />
{/* @ts-expect-error Recharts Legend accepts payload at runtime */}
            <Legend payload={legendPayload} />
          </PieChart>
        );
      }
      
      case 'composed': {
        const { needsDualAxis, leftKeys, rightKeys } = dualAxisInfo;

        // Sort datasets: Bar first, then Area, then Line (so Line renders on top)
        const sortedDatasets = [...rc.datasets].sort((a, b) => {
          const order = { bar: 0, area: 1, line: 2 };
          return (order[a.type || 'line'] || 2) - (order[b.type || 'line'] || 2);
        });

        // Keep original index for color mapping
        const datasetIndexMap = new Map(rc.datasets.map((ds, idx) => [ds.dataKey, idx]));

        return (
          <ComposedChart data={data} margin={{ top: 10, right: needsDualAxis ? 60 : 30, left: 10, bottom: 10 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey={rc.xAxis.dataKey} tick={{ fontSize: 11 }} />
            {needsDualAxis ? (
              <>
                <YAxis
                  yAxisId="left"
                  tick={{ fontSize: 11 }}
                  orientation="left"
                  stroke={CHART_COLORS[0]}
                />
                <YAxis
                  yAxisId="right"
                  tick={{ fontSize: 11 }}
                  orientation="right"
                  stroke={CHART_COLORS[1]}
                />
              </>
            ) : (
              <YAxis tick={{ fontSize: 11 }} />
            )}
            <Tooltip content={<CustomTooltip />} />
            <Legend />
            {sortedDatasets.map((ds) => {
              const originalIdx = datasetIndexMap.get(ds.dataKey) ?? 0;
              const ChartElement = ds.type === 'bar' ? Bar : ds.type === 'area' ? Area : Line;
              const yAxisId = needsDualAxis
                ? (rightKeys.includes(ds.dataKey) ? 'right' : 'left')
                : undefined;

              return (
                <ChartElement
                  key={ds.dataKey}
                  type="monotone"
                  dataKey={ds.dataKey}
                  stroke={ds.color || CHART_COLORS[originalIdx]}
                  fill={ds.color || CHART_COLORS[originalIdx]}
                  name={ds.label}
                  isAnimationActive={false}
                  {...(needsDualAxis ? { yAxisId } : {})}
                />
              );
            })}
          </ComposedChart>
        );
      }

      case 'multi-line':
        return (
          <LineChart data={data} margin={{ top: 10, right: 30, left: 10, bottom: 10 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey={rc.xAxis.dataKey} tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip content={<CustomTooltip />} />
            <Legend />
            {rc.datasets.map((ds, idx) => (
              <Line
                key={idx}
                type="monotone"
                dataKey={ds.dataKey}
                stroke={ds.color || CHART_COLORS[idx]}
                name={ds.label}
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls
              />
            ))}
          </LineChart>
        );
      
      default:
        return <div>Unsupported chart type: {chartType}</div>;
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 mt-4">
      <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2 mb-4">
        <BarChart3 className="w-5 h-5 text-indigo-600" />
        {config.title}
      </h3>
      {config.description && (
        <p className="text-sm text-gray-500 mb-4">{config.description}</p>
      )}
      <div style={{ width: '100%', height: 300 }}>
        <ResponsiveContainer width="100%" height="100%">
          {getChartComponent()}
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default DynamicChart;
