import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import { api } from "../useVault";
export interface MapPoint {
  path: string;
  title: string;
  coordinates: [number, number];
}
export default function BaseMap({
  points,
  onOpen,
}: {
  points: MapPoint[];
  onOpen: (path: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    map = useRef<L.Map | null>(null),
    markers = useRef<L.LayerGroup | null>(null);
  const openRef = useRef(onOpen);
  openRef.current = onOpen;
  const [online, setOnline] = useState(false),
    [tilesError, setTilesError] = useState(false);
  useEffect(() => {
    if (!host.current) return;
    const view = L.map(host.current, {
      attributionControl: true,
      worldCopyJump: true,
      minZoom: 1,
      preferCanvas: true,
    }).setView([20, 0], 2);
    view.attributionControl.setPrefix(false);
    const grid = L.layerGroup().addTo(view);
    for (let lat = -60; lat <= 60; lat += 30)
      L.polyline(
        [
          [lat, -180],
          [lat, 180],
        ],
        { color: "#888888", weight: 1, opacity: 0.3, interactive: false },
      ).addTo(grid);
    for (let lon = -180; lon <= 180; lon += 30)
      L.polyline(
        [
          [-85, lon],
          [85, lon],
        ],
        { color: "#888888", weight: 1, opacity: 0.3, interactive: false },
      ).addTo(grid);
    map.current = view;
    markers.current = L.layerGroup().addTo(view);
    const observer = new ResizeObserver(() => view.invalidateSize());
    observer.observe(host.current);
    return () => {
      observer.disconnect();
      view.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    const view = map.current,
      layer = markers.current;
    if (!view || !layer) return;
    layer.clearLayers();
    const color = getComputedStyle(document.documentElement)
      .getPropertyValue("--accent")
      .trim();
    for (const point of points) {
      const label = document.createElement("button");
      label.textContent = point.title;
      label.onclick = () => openRef.current(point.path);
      L.circleMarker(point.coordinates, { radius: 7, color, fillOpacity: 0.8 })
        .addTo(layer)
        .bindPopup(label)
        .bindTooltip(point.title);
    }
    if (points.length)
      view.fitBounds(L.latLngBounds(points.map((p) => p.coordinates)), {
        padding: [40, 40],
        maxZoom: 12,
      });
  }, [points]);
  useEffect(() => {
    const view = map.current;
    if (!online || !view) return;
    setTilesError(false);
    const tiles = L.tileLayer("veltrite-map://tile/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(view);
    tiles.on("tileerror", () => setTilesError(true));
    return () => {
      view.removeLayer(tiles);
    };
  }, [online]);
  return (
    <div className="base-map-view">
      <div className="base-map-controls">
        <button aria-pressed={online} onClick={() => setOnline((v) => !v)}>
          {online ? "Скрыть подложку" : "Загрузить карту OpenStreetMap"}
        </button>
        <small>
          {tilesError
            ? "Подложка недоступна. Точки остаются на карте."
            : "Координаты из свойств заметок"}
        </small>
      </div>
      <div
        ref={host}
        className="base-map"
        aria-label="Карта заметок"
        onClick={(event) => {
          const link = (event.target as HTMLElement).closest("a[href^='https:']");
          if (link) {
            event.preventDefault();
            void api().openExternal(link.getAttribute("href")!);
          }
        }}
      />
      <div className="base-map-points">
        {points.length ? (
          points.map((point) => (
            <button
              key={point.path}
              onClick={() => {
                map.current?.setView(point.coordinates, 12);
                onOpen(point.path);
              }}
            >
              {point.title}
              <small>{point.coordinates.join(", ")}</small>
            </button>
          ))
        ) : (
          <p>Нет заметок с допустимыми координатами. Добавьте latitude и longitude.</p>
        )}
      </div>
    </div>
  );
}
