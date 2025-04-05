const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const app = express();
const dotenv = require('dotenv');
const mongoose = require('mongoose');
const PORT = process.env.PORT || 3000;
const axios = require('axios');
const { getInstagramBusinessAccountId, fetchAccountDetails, fetchAccountInsights, fetchFollowerDemographics } = require('./InstagramUserInsights');
const { fetchInstagramPosts, fetchTopPosts } = require('./InstagramPostInsights');

// Configuration
dotenv.config();

// Track MongoDB connection state
let isConnected = false;
let connectionPromise = null;

// MongoDB connection function with connection reuse
async function connectToMongo() {
  if (isConnected) return Promise.resolve();
  
  // If connection is in progress, return the existing promise
  if (connectionPromise) return connectionPromise;
  
  // Create a new connection promise
  connectionPromise = mongoose.connect("mongodb+srv://suhas:suhas2244@cluster0.nhaclgq.mongodb.net/facebookAuth", {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    bufferCommands: true, // Changed to true to avoid the error
    serverSelectionTimeoutMS: 10000 // Increased timeout
  })
  .then(() => {
    console.log('Connected to MongoDB');
    isConnected = true;
  })
  .catch((error) => {
    console.error('MongoDB connection error:', error);
    isConnected = false;
    connectionPromise = null; // Reset promise on error
    throw error;
  });
  
  return connectionPromise;
}

// MongoDB schema and model
const TokenSchema = new mongoose.Schema({
  access_token: String,
  token_type: String,
  expires_in: Number,
  last_updated: { type: Date, default: Date.now } // Track when this token was last used to update metrics
});

const Token = mongoose.models.Token || mongoose.model("Token", TokenSchema);

const CONFIG = {
  updateInterval: 3600000, // 1 hour in milliseconds
  outputDir: path.join(__dirname, 'metrics'),
  defaultDayCount: 30
};

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;

const MetricSchema = new mongoose.Schema({
  accountId: { type: String, required: true }, // Instagram business account ID
  token: { type: String, required: true }, // Store which token this metric is for
  timestamp: { type: Date, default: Date.now }, // Timestamp of the metric collection
  accountDetails: Object,
  accountInsights: Object,
  posts: Object,
  topPosts: Object,
  followerDemographics: Object, // Added follower demographics
});

const Metric = mongoose.models.Metric || mongoose.model("Metric", MetricSchema);

async function saveMetricsToDB(metrics) {
  try {
    // Ensure we're connected before attempting to save
    await connectToMongo();
    
    const filter = { 
      accountId: metrics.accountId,
      token: metrics.token // Also filter by token
    };
    
    const update = {
      $set: {
        timestamp: new Date(),
        accountDetails: metrics.accountDetails,
        accountInsights: metrics.accountInsights,
        posts: metrics.posts,
        topPosts: metrics.topPosts,
        followerDemographics: metrics.followerDemographics, // Added follower demographics
      },
    };
    
    const options = { upsert: true, new: true }; // Upsert option to update or insert

    const result = await Metric.findOneAndUpdate(filter, update, options);
    console.log(`Metrics updated/inserted for accountId: ${metrics.accountId} with token: ${metrics.token?.substring(0, 10)}...`);
    
    // Also update the last_updated timestamp for this token
    if (metrics.token) {
      await Token.updateOne(
        { access_token: metrics.token },
        { $set: { last_updated: new Date() } }
      );
    }
    
    return result;
  } catch (error) {
    console.error('Error saving/updating metrics to MongoDB:', error);
    throw error;
  }
}

// Middleware to ensure MongoDB connection before handling requests
app.use(async (req, res, next) => {
  try {
    await connectToMongo();
    next();
  } catch (error) {
    console.error('Database connection failed in middleware:', error);
    res.status(500).json({ error: 'Database connection failed', details: error.message });
  }
});

// Add CORS headers for Vercel deployment
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

app.get("/callback", async (req, res) => {
  const { code } = req.query;
  if (!code) {
    return res.status(400).json({ success: false, message: "No code provided" });
  }

  try {
    // Ensure MongoDB connection
    await connectToMongo();
    
    // Exchange the code for an access token
    const tokenUrl = `https://graph.facebook.com/v20.0/oauth/access_token?client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}&redirect_uri=${REDIRECT_URI}&code=${code}`;
    const tokenResponse = await axios.get(tokenUrl);
    const tokenData = tokenResponse.data;

    try {
      // Check if token already exists to avoid duplicates
      const existingToken = await Token.findOne({ access_token: tokenData.access_token });
      if (!existingToken) {
        // Save the new token to the database
        const savedtoken = await Token.create(tokenData);
        console.log("Token saved to database with ID:", savedtoken._id);
        
        // Trigger an immediate metrics update for the new token
        await updateMetricsForToken(tokenData.access_token, `new_token_${Date.now()}`);

        // Trigger the /api/update function to update all metrics
        await updateAllMetrics();
        console.log("Metrics updated after adding new user.");
      } else {
        console.log("Token already exists in database, skipping save");
      }
    } catch (dbError) {
      console.error("MongoDB save error:", dbError);
    }

    // Redirect the user after successful token exchange
    res.redirect("https://instagram-aapi-phi.vercel.app/");
  } catch (error) {
    console.error("Error retrieving access token:", error.response?.data || error.message);
    res.status(500).json({
      success: false,
      message: "Error retrieving access token",
      error: error.response?.data || error.message,
      code,
    });
  }
});
// Ensure output directory exists
async function ensureOutputDir() {
  try {
    await fs.mkdir(CONFIG.outputDir, { recursive: true });
    console.log(`Output directory created/verified: ${CONFIG.outputDir}`);
  } catch (error) {
    console.error('Error creating output directory:', error);
    // Don't exit on Vercel
    if (process.env.VERCEL !== '1') {
      process.exit(1);
    }
  }
}

// Main function to collect all metrics for a given access token and account
async function collectAllMetrics(accessToken, instagramBusinessAccountId, tokenIdentifier) {
  try {
    const [
      accountDetails,
      accountInsights,
      posts,
      topPosts,
      followerDemographics // Added follower demographics
    ] = await Promise.all([
      fetchAccountDetails(accessToken, instagramBusinessAccountId),
      fetchAccountInsights(accessToken, instagramBusinessAccountId),
      fetchInstagramPosts(accessToken, instagramBusinessAccountId),
      fetchTopPosts(accessToken, instagramBusinessAccountId),
      fetchFollowerDemographics(accessToken, instagramBusinessAccountId) // New API call
    ]);

    return {
      timestamp: new Date().toISOString(),
      accountId: instagramBusinessAccountId,
      token: accessToken, // Store which token was used
      tokenIdentifier, // For logging purposes
      accountDetails,
      accountInsights,
      posts,
      topPosts,
      followerDemographics // Include in returned data
    };
  } catch (error) {
    console.error(`Error collecting metrics for account ${instagramBusinessAccountId} with token ${tokenIdentifier}:`, error);
    return {
      timestamp: new Date().toISOString(),
      accountId: instagramBusinessAccountId,
      token: accessToken,
      tokenIdentifier,
      error: error.message || 'Unknown error occurred'
    };
  }
}

// Function to get tokens from MongoDB with retry
async function getTokensFromMongoDB() {
  try {
    await connectToMongo(); // Ensure connection before query
    
    const tokens = await Token.find().lean();
    const tokenMap = {};

    tokens.forEach((token, index) => {
      tokenMap[`token_${index}`] = token.access_token;
    });

    console.log(`Retrieved ${tokens.length} tokens from MongoDB`);
    return tokenMap;
  } catch (error) {
    console.error('Error retrieving tokens from MongoDB:', error);
    
    // Retry once after a delay
    try {
      console.log('Retrying token retrieval after 2 seconds...');
      await new Promise(resolve => setTimeout(resolve, 2000));
      await connectToMongo();
      
      const tokens = await Token.find().lean();
      const tokenMap = {};

      tokens.forEach((token, index) => {
        tokenMap[`token_${index}`] = token.access_token;
      });

      console.log(`Retrieved ${tokens.length} tokens from MongoDB on retry`);
      return tokenMap;
    } catch (retryError) {
      console.error('Error retrieving tokens on retry:', retryError);
      return {};
    }
  }
}

// Function to update metrics for a specific token
async function updateMetricsForToken(accessToken, identifier) {
  try {
    console.log(`Processing token: ${identifier}`);

    const businessAccounts = await getInstagramBusinessAccountId(accessToken);

    if (businessAccounts.length === 0) {
      console.log(`No Instagram business accounts found for token: ${identifier}`);
      return;
    }

    const updatePromises = [];
    
    for (const accountId of businessAccounts) {
      console.log(`Collecting metrics for account: ${accountId} with token: ${identifier}`);
      const metrics = await collectAllMetrics(accessToken, accountId, identifier);
      updatePromises.push(saveMetricsToDB(metrics));
    }
    
    await Promise.all(updatePromises);
    console.log(`Completed metrics update for token: ${identifier}`);
  } catch (error) {
    console.error(`Error processing token ${identifier}:`, error);
  }
}

// Main function to update metrics for all tokens with parallel processing
async function updateAllMetrics() {
  console.log(`Starting metrics update at ${new Date().toISOString()}`);

  try {
    // Ensure MongoDB connection
    await connectToMongo();
    
    const tokens = await getTokensFromMongoDB();

    if (Object.keys(tokens).length === 0) {
      console.log('No tokens found in database. Skipping metrics update.');
      return;
    }

    // Process all tokens in parallel
    const updatePromises = Object.entries(tokens).map(([identifier, accessToken]) => 
      updateMetricsForToken(accessToken, identifier)
    );
    
    await Promise.all(updatePromises);
    
    console.log(`Metrics update completed at ${new Date().toISOString()}`);
  } catch (error) {
    console.error('Error in updateAllMetrics:', error);
  }
}

// API endpoint to get latest metrics for an account
app.get('/api/metrics/:accountId', async (req, res) => {
  const { accountId } = req.params;
  
  try {
    // Ensure MongoDB connection
    await connectToMongo();
    
    console.log(`Fetching metrics for accountId: ${accountId}`);
    const metrics = await Metric.find({ accountId })
      .sort({ timestamp: -1 })
      .limit(1)
      .lean();

    if (!metrics.length) {
      return res.status(404).json({ error: "No metrics found for this accountId" });
    }

    res.json(metrics[0]);
  } catch (error) {
    console.error('Error fetching metrics:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: error.message,
      stack: process.env.NODE_ENV === 'production' ? '🥞' : error.stack
    });
  }
});

// New endpoint to get metrics for all accounts (latest for each)
app.get('/api/metrics', async (req, res) => {
  try {
    // Ensure MongoDB connection
    await connectToMongo();
    
    // Get all unique accountIds
    const accounts = await Metric.distinct('accountId');
    
    const allMetrics = [];
    for (const accountId of accounts) {
      const metric = await Metric.findOne({ accountId })
        .sort({ timestamp: -1 })
        .lean();
        
      if (metric) {
        allMetrics.push(metric);
      }
    }
    
    res.json(allMetrics);
  } catch (error) {
    console.error('Error fetching all metrics:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: error.message,
      stack: process.env.NODE_ENV === 'production' ? '🥞' : error.stack
    });
  }
});

// Configure express app
app.use(express.json());

// Status endpoint
app.get('/api/status', async (req, res) => {
  try {
    await connectToMongo();
    const tokens = await Token.find().lean();
    const metrics = await Metric.countDocuments();
    
    // Calculate next update
    let nextUpdateTime = null;
    if (tokens.length > 0) {
      // Find the oldest last_updated timestamp
      const oldestUpdate = tokens.reduce((oldest, token) => {
        if (!oldest || !token.last_updated || token.last_updated < oldest) {
          return token.last_updated || new Date(0);
        }
        return oldest;
      }, null);
      
      if (oldestUpdate) {
        nextUpdateTime = new Date(oldestUpdate.getTime() + CONFIG.updateInterval);
      }
    }

    res.json({
      status: 'running',
      tokens: tokens.length,
      tokenDetails: tokens.map(t => ({
        id: t._id,
        expiresIn: t.expires_in,
        lastUpdated: t.last_updated
      })),
      metrics: metrics,
      nextUpdate: nextUpdateTime,
      environment: process.env.VERCEL ? 'Vercel' : 'Server'
    });
  } catch (error) {
    res.status(500).json({
      error: 'Error fetching status',
      message: error.message
    });
  }
});

// For Vercel: This is the crucial endpoint to update metrics
// We'll make this a serverless function that can be triggered
app.get('/api/update', async (req, res) => {
  try {
    console.log('Triggered metrics update via API endpoint');
    await connectToMongo();
    await updateAllMetrics();
    res.json({ 
      success: true, 
      message: 'Metrics updated successfully', 
      timestamp: new Date().toISOString() 
    });
  } catch (error) {
    console.error('Error updating metrics via API:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Start server with different behavior for local vs Vercel
let nextUpdateTime = null;
let updateInterval = null;

async function startServer() {
  try {
    // Ensure MongoDB connection first
    await connectToMongo();
    
    // Create output directory for file storage (if running on server, not Vercel)
    if (!process.env.VERCEL) {
      await ensureOutputDir();
    }

    // Start listening
    const server = app.listen(PORT, () => {
      console.log(`Instagram Metrics Server running on port ${PORT}`);
      console.log(`Environment: ${process.env.VERCEL ? 'Vercel' : 'Local Server'}`);

      // Schedule initial update only for non-Vercel environments
      if (!process.env.VERCEL) {
        scheduleNextUpdate();
      } else {
        console.log('Running on Vercel - background updates disabled. Use /api/update endpoint instead.');
        // Trigger an initial update
        updateAllMetrics().catch(err => console.error('Error in initial Vercel update:', err));
      }
    });
    
    // Handle graceful shutdown
    const shutdown = () => {
      console.log('Shutdown signal received, closing server...');
      if (updateInterval) {
        clearTimeout(updateInterval);
      }
      
      server.close(() => {
        console.log('Server closed');
        mongoose.connection.close(false, () => {
          console.log('MongoDB connection closed');
          process.exit(0);
        });
      });
    };
    
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
    
    return server;
  } catch (error) {
    console.error('Failed to start server:', error);
    if (!process.env.VERCEL) {
      process.exit(1);
    }
    throw error;
  }
}

function scheduleNextUpdate() {
  nextUpdateTime = new Date(Date.now() + CONFIG.updateInterval);
  console.log(`Next metrics update scheduled for: ${nextUpdateTime.toISOString()}`);

  updateInterval = setTimeout(async () => {
    try {
      await updateAllMetrics();
    } catch (error) {
      console.error('Error during scheduled metrics update:', error);
    } finally {
      scheduleNextUpdate();
    }
  }, CONFIG.updateInterval);
}

// Detect if we're running on Vercel or locally
const isVercel = process.env.VERCEL === '1';

// For local dev, start the server normally
if (!isVercel) {
  startServer().catch(error => {
    console.error('Failed to start server:', error);
  });
}

module.exports = app;