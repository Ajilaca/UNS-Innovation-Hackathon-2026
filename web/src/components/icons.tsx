import type { ReactNode } from "react";

const base = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;
const I = (d: ReactNode) => () => <svg {...base}>{d}</svg>;

export const IconLive = I(<><path d="M2 8h2.5l1.5-4 3 8 1.5-4H14" /></>);
export const IconBatch = I(<><rect x="2.5" y="2.5" width="11" height="11" rx="2" /><path d="M5.5 6h5M5.5 8.5h5M5.5 11h3" /></>);
export const IconCompare = I(<><path d="M3 13V7M8 13V3M13 13V9" /></>);
export const IconModel = I(<><circle cx="4" cy="4" r="1.6" /><circle cx="4" cy="12" r="1.6" /><circle cx="12" cy="8" r="1.6" /><path d="M5.5 4.6l5 2.8M5.5 11.4l5-2.8" /></>);
export const IconMenu = I(<><path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" /></>);
export const IconOut = I(<><path d="M6 2.5H3.5v11H6M10 5l3 3-3 3M13 8H6.5" /></>);
export const IconDownload = I(<><path d="M8 2.5v8M4.5 7.5L8 11l3.5-3.5M3 13.5h10" /></>);

export const IconHome = I(<><path d="M2.5 7.5L8 3l5.5 4.5M4 6.5v7h8v-7M6.5 13.5V10h3v3.5" /></>);
export const IconBulb = I(<><path d="M5.8 11.2A4.5 4.5 0 1 1 10.2 11.2V12.5H5.8zM6.5 14.5h3" /></>);
export const IconDoc = I(<><path d="M4 2h5.5L12 4.5V14H4zM9.5 2v2.5H12M6 8h4M6 10.5h4" /></>);
export const IconBell = I(<><path d="M4 11.5V7a4 4 0 0 1 8 0v4.5l1 1H3zM6.8 14.5h2.4" /></>);
export const IconPlay = I(<><path d="M5 3.5v9l7-4.5z" fill="currentColor" /></>);
export const IconClock = I(<><circle cx="8" cy="8" r="5.8" /><path d="M8 4.8V8l2.2 1.5" /></>);
export const IconDrop = I(<><path d="M8 2c2.6 3.3 4.2 5.4 4.2 7.6a4.2 4.2 0 0 1-8.4 0C3.800 7.400 5.400 5.300 8 2z" /></>);
export const IconBolt = I(<><path d="M9 1.800L3.500 9H8l-1 5.200L12.500 7H8z" /></>);
export const IconFlame = I(<><path d="M6.500 2v7.300a2.800 2.800 0 1 0 3 0V2a1.500 1.500 0 0 0-3 0zM8 8v3" /></>);
export const IconWave = I(<><path d="M1.500 8.500h2.200l1.500-3.500 2.300 6 2-4.500 1 2h3" /></>);
export const IconPulse = IconWave;
export const IconLayers = I(<><path d="M8 2l6 3.200-6 3.200-6-3.200zM2 8.200l6 3.200 6-3.200M2 11l6 3.200L14 11" /></>);
export const IconCheck = I(<><circle cx="8" cy="8" r="5.800" /><path d="M5.500 8.200l1.800 1.800 3.300-3.600" /></>);
export const IconSparkle = I(<><path d="M7 2l1.300 3.700L12 7l-3.700 1.300L7 12 5.700 8.300 2 7l3.700-1.300zM12.500 10.500l.6 1.400 1.400.6-1.400.6-.6 1.400-.6-1.400-1.400-.6 1.400-.6z" /></>);
export const IconSun = I(<><circle cx="8" cy="8" r="2.800" /><path d="M8 1.500v1.800M8 12.700v1.800M1.500 8h1.800M12.700 8h1.800M3.400 3.400l1.300 1.300M11.300 11.300l1.300 1.300M3.400 12.600l1.300-1.300M11.300 4.700l1.300-1.300" /></>);
export const IconBattery = I(<><rect x="2" y="4.500" width="10.500" height="7" rx="1.500" /><path d="M14 7v2M4.500 6.800v2.400M7 6.800v2.400" /></>);
export const IconPlug = I(<><path d="M5.500 2v3.500M10.500 2v3.500M3.500 5.500h9V8a4.500 4.500 0 0 1-9 0zM8 12.500V15" /></>);
export const IconWrench = I(<><path d="M13.500 4.200l-2.300 2.300-1.700-.4-.4-1.700L11.400 2a3.600 3.600 0 0 0-4.800 4.500L2.400 10.700a1.800 1.800 0 0 0 2.600 2.600l4.200-4.200a3.600 3.600 0 0 0 4.300-5z" /></>);

export const IconSliders = I(<><path d="M2 4.500h6.500M11.500 4.500H14M2 11.500h2.500M7.500 11.500H14" /><circle cx="10" cy="4.500" r="1.500" /><circle cx="6" cy="11.500" r="1.500" /></>);
export const IconSolar = I(<><path d="M4 3h8l2 6H2zM6.500 3L6 9M9.500 3L10 9M3 6h10M8 9v4M5.500 13.500h5" /></>);
export const IconShield = I(<><path d="M8 1.800l5 1.700v4c0 3.200-2 5.400-5 6.700-3-1.300-5-3.500-5-6.700v-4z" /></>);
export const IconSensor = I(<><circle cx="8" cy="8" r="1.500" /><path d="M5.200 5.200a4 4 0 0 0 0 5.600M10.800 5.200a4 4 0 0 1 0 5.600M3.200 3.200a6.800 6.800 0 0 0 0 9.600M12.800 3.200a6.800 6.800 0 0 1 0 9.600" /></>);
export const IconBrain = I(<><path d="M6.500 2.500A2 2 0 0 0 4.500 4.500 2.300 2.300 0 0 0 3 8.700 2.300 2.300 0 0 0 4.800 12.800a1.900 1.900 0 0 0 3.200.700V3.300a2 2 0 0 0-1.500-.800zM9.500 2.500a2 2 0 0 1 2 2 2.300 2.300 0 0 1 1.500 4.200 2.300 2.300 0 0 1-1.800 4.100 1.900 1.900 0 0 1-3.200.700" /><path d="M5 6.500h1.500M9.500 6.500H11M5.300 10h1.200M9.500 10h1.200" /></>);
export const IconTrend = I(<><path d="M2 11.500l4-4 2.500 2.500L14 4.500M10 4.500h4v4" /></>);
export const IconInfo = I(<><circle cx="8" cy="8" r="5.800" /><path d="M8 7.200v3.500M8 5.200v.1" /></>);

export const IconTower = I(<><path d="M8 1.500L4.500 14.500M8 1.500l3.500 13M3 5h10M4 8.500h8M5.800 8.500L10.800 12.500M10.200 8.500L5.200 12.500" /></>);
export const IconHybrid = I(<><path d="M2 3h6.500L10 8H1zM4.500 3L4 8M6.500 3L7 8M5.500 8v5M3.500 13.500h4M12.500 2.500v3M14 2.500v3M11.500 5.500h3.500v1.500a1.700 1.700 0 0 1-3.500 0zM13.200 8.700v2.300a2 2 0 0 1-2 2H9.500" /></>);
export const IconCoins = I(<><ellipse cx="8" cy="4" rx="5" ry="2" /><path d="M3 4v4c0 1.100 2.200 2 5 2s5-.9 5-2V4M3 8v4c0 1.100 2.200 2 5 2s5-.9 5-2V8" /></>);
export const IconStar = I(<><path d="M8 2l1.800 3.800 4.200.5-3.100 2.900.8 4.200L8 11.300l-3.700 2.100.8-4.200L2 6.300l4.200-.5z" fill="currentColor" /></>);

export const IconLeaf = I(<><path d="M13.500 2.500C7 2.500 3 5.500 3 10a3 3 0 0 0 3 3c4.500 0 7.500-4 7.500-10.500zM2.500 14L9 7.500" /></>);
export const IconSwap = I(<><path d="M2.500 5.500h10M9.500 2.500l3 3-3 3M13.500 10.500h-10M6.500 7.500l-3 3 3 3" /></>);

export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <path d="M16 2.500c5.800 7 10 11.700 10 16.800a10 10 0 0 1-20 0C6 14.200 10.200 9.500 16 2.500z" fill="#0f7a5f" />
      <path d="M8 20c3.500-3 6-3 8.500-1s5 2 7.500-.8M9.500 24.500c3-2.200 5-2.200 7-.8s4 1.400 6-.5" fill="none" stroke="#fff" strokeWidth="1.700" strokeLinecap="round" />
    </svg>
  );
}

export const IconClipboard = I(<><rect x="3.500" y="3" width="9" height="11" rx="1.800" /><path d="M6 3V2.200h4V3M5.800 7.500h4.400M5.800 10.500h3" /></>);
export const IconCheckSquare = I(<><rect x="2.500" y="2.500" width="11" height="11" rx="2.500" /><path d="M5.300 8.200l1.900 1.900 3.500-3.700" /></>);
export const IconTrash = I(<><path d="M3 4.500h10M6.200 4.500V3h3.600v1.500M4.500 4.500l.6 8.500h5.800l.6-8.500M6.800 7v3.600M9.200 7v3.600" /></>);
export const IconFlask = I(<><path d="M6.200 2.500h3.600M7 2.500v4L3.600 12.300A1 1 0 0 0 4.500 13.800h7a1 1 0 0 0 .9-1.500L9 6.500v-4M5 10h6" /></>);
