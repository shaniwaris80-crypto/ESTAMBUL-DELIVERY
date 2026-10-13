import { NextResponse } from "next/server";
import { execute, snapshot } from "../../../lib/demo-store";
import type { DemoCommand } from "@estambul/shared";
export const runtime="nodejs";export const dynamic="force-dynamic";
const enabled=()=>process.env.NODE_ENV==="development";
export async function GET(){if(!enabled())return NextResponse.json({error:"Demo API deshabilitada"},{status:404});return NextResponse.json(snapshot(),{headers:{"Cache-Control":"no-store"}});}
export async function POST(request:Request){if(!enabled())return NextResponse.json({error:"Demo API deshabilitada"},{status:404});try{const command=await request.json() as DemoCommand;return NextResponse.json(execute(command),{headers:{"Cache-Control":"no-store"}});}catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Solicitud inválida"},{status:400});}}
