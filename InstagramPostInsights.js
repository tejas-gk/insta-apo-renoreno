async function fetchInstagramPosts(accessToken, instagramBusinessAccountId) {
  const postsUrl = `https://graph.facebook.com/v20.0/${instagramBusinessAccountId}/media?fields=id,caption,media_type,media_url,thumbnail_url,children{id,media_type,media_url,thumbnail_url}&access_token=${accessToken}`;

  const fetchPostInsights = async (postId) => {
    const insightsUrl = `https://graph.facebook.com/v20.0/${postId}/insights?metric=impressions,reach,saved,likes,comments,shares&access_token=${accessToken}`;
    const impressionsBreakdownUrl = `https://graph.facebook.com/v20.0/${postId}/insights?metric=impressions&breakdown=surface_type&access_token=${accessToken}`;

    try {
      // Fetch standard insights
      const insightsResponse = await fetch(insightsUrl);
      const insightsData = await insightsResponse.json();

      // Fetch impressions breakdown data
      const impressionsBreakdownResponse = await fetch(impressionsBreakdownUrl);
      const impressionsBreakdownData = await impressionsBreakdownResponse.json();

      // Combine both insights and impressions breakdown data
      const combinedInsights = {
        ...insightsData,
        impressions_breakdown: impressionsBreakdownData.data || [],
      };

      return combinedInsights;
    } catch (error) {
      console.error(`Error fetching insights for post ${postId}:`, error);
      return { data: [], impressions_breakdown: [] };
    }
  };

  try {
    // Fetch posts data
    const response = await fetch(postsUrl);
    if (!response.ok) {
      throw new Error(`Error fetching Instagram posts: ${response.statusText}`);
    }

    const data = await response.json();

    // Initialize containers for post types
    const posts = {
      posts: [], // Single image or video posts
      reels: [], // Reels (videos)
      carousels: [], // Carousel posts
    };

    // Fetch insights for each post and categorize them
    for (const post of data.data) {
      const insights = await fetchPostInsights(post.id);
      const postWithInsights = { ...post, insights };

      if (post.media_type === "CAROUSEL_ALBUM" && post.children) {
        // Handle carousel posts
        const carouselChildren = post.children.data.map((child) => ({
          id: child.id,
          media_type: child.media_type,
          media_url: child.media_url,
          thumbnail_url: child.thumbnail_url,
        }));

        // Add carousel post with insights and children
        posts.carousels.push({
          ...postWithInsights,
          children: carouselChildren,
        });
      } else if (post.media_type === "VIDEO" && post.thumbnail_url) {
        // Handle reels (videos)
        posts.reels.push(postWithInsights);
      } else {
        // Handle single image posts
        posts.posts.push(postWithInsights);
      }
    }

    return posts;
  } catch (error) {
    console.error("Error fetching Instagram posts or insights:", error);
    return null;
  }
}

async function fetchTopPosts(accessToken, instagramBusinessAccountId) {
  let topPostByLikes = null;
  let topPostByComments = null;
  let maxLikes = 0;
  let maxComments = 0;

  try {
    const postsUrl = `https://graph.facebook.com/v20.0/${instagramBusinessAccountId}/media?fields=id,caption,media_type,media_url,thumbnail_url,like_count,comments_count&access_token=${accessToken}`;
    const response = await fetch(postsUrl);

    if (!response.ok) {
      throw new Error(`Error fetching posts: ${response.statusText}`);
    }

    const data = await response.json();

    if (!data.data || data.data.length === 0) {
      return {
        topPostByLikes: null,
        topPostByComments: null,
        maxLikes: 0,
        maxComments: 0,
      };
    }

    data.data.forEach((post) => {
      if (post.like_count > maxLikes) {
        maxLikes = post.like_count;
        topPostByLikes = post;
      }
      if (post.comments_count > maxComments) {
        maxComments = post.comments_count;
        topPostByComments = post;
      }
    });

    return {
      topPostByLikes,
      topPostByComments,
      maxLikes,
      maxComments,
    };
  } catch (error) {
    console.error("Error fetching top posts:", error);
    return {
      topPostByLikes: null,
      topPostByComments: null,
      maxLikes: 0,
      maxComments: 0,
    };
  }
}

module.exports = { fetchInstagramPosts, fetchTopPosts };