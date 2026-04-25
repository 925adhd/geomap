import type { GridPoint } from "./types";

export function generateGrid(
  center: [number, number],
  radiusKm: number,
  rows: number,
  cols: number
): GridPoint[] {
  const [lat, lng] = center;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const latRange = radiusKm / 111;
  const lngRange = radiusKm / (111 * cosLat);
  const points: GridPoint[] = [];
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const f = rows === 1 ? 0.5 : i / (rows - 1);
      const g = cols === 1 ? 0.5 : j / (cols - 1);
      points.push({
        lat: lat - latRange + f * 2 * latRange,
        lng: lng - lngRange + g * 2 * lngRange,
        row: i,
        col: j,
      });
    }
  }
  return points;
}
