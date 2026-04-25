export type PlaceResult = {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  rating?: number;
  userRatingCount?: number;
  location?: { latitude: number; longitude: number };
};

export type TargetBusiness = {
  placeId: string;
  name: string;
  address: string;
  location: { latitude: number; longitude: number } | null;
};

export type GridPoint = {
  lat: number;
  lng: number;
  row: number;
  col: number;
};

export type ScanPoint = GridPoint & {
  rank: number | null;
  topResult?: string | null;
  topThree?: string[];
  error?: string;
};

export type Scan = {
  timestamp: string;
  target: TargetBusiness;
  keyword: string;
  gridRows: number;
  gridCols: number;
  radiusMiles: number;
  center: [number, number];
  points: ScanPoint[];
  gridSize?: number;
  // Optional manual override for the "Where to start" callout in the report.
  // If unset, the report auto-generates a recommendation from the scan stats
  // (score, missing points, top rival, etc). Set this to override that.
  recommendation?: string;
};

export type HistoryEntry = {
  timestamp: string;
  targetName: string;
  keyword: string;
  gridSize: number;
  summary: { total: number; top3: number; avgRank: string };
  full: Scan;
};

export function gridLabel(scan: Scan): string {
  if (scan.gridRows && scan.gridCols)
    return `${scan.gridRows}×${scan.gridCols}`;
  if (scan.gridSize) return `${scan.gridSize}×${scan.gridSize}`;
  return "?";
}

export function gridPointCount(scan: Scan): number {
  if (scan.gridRows && scan.gridCols) return scan.gridRows * scan.gridCols;
  if (scan.gridSize) return scan.gridSize * scan.gridSize;
  return scan.points?.length ?? 0;
}
