import { NextResponse } from 'next/server';
import { scoutIp } from '@/lib/agent/ip-scout.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 600;

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  try {
    return NextResponse.json(await scoutIp(body?.text));
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
