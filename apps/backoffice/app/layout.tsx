import "./globals.css";
import "leaflet/dist/leaflet.css";
import type { Metadata } from "next";
export const metadata: Metadata = { title: "Estambul Delivery | Back Office DEMO", description: "Centro de operaciones — simulación sin pedidos reales" };
export default function RootLayout({children}: Readonly<{children:React.ReactNode}>) {return <html lang="es"><body>{children}</body></html>}
