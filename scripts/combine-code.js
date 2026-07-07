// Combine with word-count duration estimation
// Place this in your combine Code node after Merge

// Get original scene data (from seperate-audio which has voice_over)
const originalScenes = $("seperate-audio").all();

// Get merged items (image URLs + audio URLs from Merge node)
const mergedItems = $input.all();

// Separate image and audio items from the merged array
// Assuming Merge appends: images first, then audios
const mid = Math.floor(mergedItems.length / 2);
const imageItems = mergedItems.slice(0, mid);
const audioItems = mergedItems.slice(mid);

const result = [];

for (let i = 0; i < Math.max(imageItems.length, audioItems.length); i++) {
  const img = imageItems[i]?.json || {};
  const audio = audioItems[i]?.json || {};
  const scene = originalScenes[i]?.json || {};

  const voiceOver = scene.voice_over || '';
  
  // Estimate speaking duration from word count
  // Average: ~2.8 words/second for mixed Bangla/English
  const words = voiceOver.split(/\s+/).filter(Boolean).length;
  const scriptDuration = scene.duration || 5;
  const estimatedDuration = Math.max(
    scriptDuration,
    Math.ceil(words / 2.8),  // realistic speaking rate
    3  // minimum 3 seconds
  );

  result.push({
    json: {
      imageUrl: img.url || img.uploadData?.url || img.imageUrl || '',
      audioUrl: audio.url || audio.uploadData?.url || audio.audioUrl || '',
      caption: voiceOver,
      duration: estimatedDuration,
      scene_number: scene.scene_number || (i + 1),
    }
  });
}

return result;
