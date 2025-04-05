import { NextResponse } from 'next/server';
import { updateAllMetrics } from '../../path-to-your-updateAllMetrics-function';

export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  try {
    console.log('Triggered metrics update via Edge Function');

    // Trigger the metrics update immediately
    await updateAllMetrics();
    console.log('Metrics updated at:', new Date().toISOString());

    // Schedule the next update in 1 hour (3600 seconds)
    setTimeout(async () => {
      await fetch('https://instagram-aapi-phi.vercel.app/api/update');
    }, 3600 * 1000); // 1 hour in milliseconds

    return NextResponse.json({
      success: true,
      message: 'Metrics updated. Next update scheduled in 1 hour.',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error updating metrics via Edge Function:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message,
      },
      { status: 500 }
    );
  }
}