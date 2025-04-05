async function getInstagramBusinessAccountId(accessToken) {
  try {
      // Step 1: Get Facebook User Data
      const userDataResponse = await fetch(
          `https://graph.facebook.com/v12.0/me?fields=id&access_token=${accessToken}`
      );
      const userData = await userDataResponse.json();

      // Step 2: Get All Accounts from Facebook
      const accountsResponse = await fetch(
          `https://graph.facebook.com/v12.0/${userData.id}/accounts?fields=instagram_business_account&access_token=${accessToken}`
      );
      const accountsData = await accountsResponse.json();

      // Step 3: Get Instagram Business Account ID
      const instagramBusinessAccounts = [];
      for (let account of accountsData.data) {
          if (account.instagram_business_account) {
              instagramBusinessAccounts.push(account.instagram_business_account.id);
          }
      }

      if (instagramBusinessAccounts.length > 0) {
          return instagramBusinessAccounts;
      } else {
          console.error("No Instagram Business Accounts found");
          return [];
      }
  } catch (error) {
      console.error("Error getting Instagram Business Account ID:", error);
      return [];
  }
}

async function fetchAccountDetails(accessToken, instagramBusinessAccountId) {
  const url = `https://graph.facebook.com/v20.0/${instagramBusinessAccountId}?fields=username,website,profile_picture_url,followers_count,follows_count,media_count,biography&access_token=${accessToken}`;

  try {
      const response = await fetch(url);
      if (!response.ok) {
          throw new Error(`Error fetching Instagram account details: ${response.statusText}`);
      }
      return await response.json();
  } catch (error) {
      console.error("Error fetching Instagram account data:", error);
      return null;
  }
}

async function fetchAccountInsights(accessToken, instagramBusinessAccountId) {
  const url = `https://graph.facebook.com/v20.0/${instagramBusinessAccountId}/insights?metric=impressions,reach,follower_count&period=day&access_token=${accessToken}`;

  try {
      const response = await fetch(url);
      if (!response.ok) {
          throw new Error(`Error fetching Instagram account insights: ${response.statusText}`);
      }
      return await response.json();
  } catch (error) {
      console.error("Error fetching Instagram account insights:", error);
      return null;
  }
}

async function fetchFollowerDemographics(accessToken, instagramBusinessAccountId) {
  const url = `https://graph.facebook.com/v20.0/${instagramBusinessAccountId}/insights?metric=follower_demographics&period=lifetime&metric_type=total_value&breakdown=country&access_token=${accessToken}`;

  try {
      const response = await fetch(url);
      if (!response.ok) {
          throw new Error(`Error fetching follower demographics: ${response.statusText}`);
      }
      return await response.json();
  } catch (error) {
      console.error("Error fetching follower demographics:", error);
      return null;
  }
}

module.exports = { getInstagramBusinessAccountId, fetchAccountDetails, fetchAccountInsights, fetchFollowerDemographics };
