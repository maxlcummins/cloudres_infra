import axios from 'axios';

export const uploadFiles = async (files, onProgress) => {
  const formData = new FormData();
  
  // Append all files to the form data
  files.forEach(file => {
    formData.append('files', file);
  });
  
  try {
    // Development mode: simulate upload for test files
    if (process.env.NODE_ENV === 'development' && 
        (files.length === 0 || files[0]?.name?.includes('test'))) {
      console.log("DEV MODE: Simulating file upload...");
      
      // Simulate progress updates
      for (let percent = 0; percent <= 100; percent += 10) {
        await new Promise(r => setTimeout(r, 300)); // Delay to simulate network
        if (onProgress) {
          onProgress({ loaded: percent, total: 100 });
        }
      }
      
      // Return mock response
      return { run_id: "test-" + Math.random().toString(36).substring(2, 10) };
    }
    
    // Real upload with axios
    const response = await axios.post('/api/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      onUploadProgress: progressEvent => {
        console.log("Upload progress event:", progressEvent);
        if (onProgress && progressEvent.total) {
          // Make sure progressEvent has both loaded and total
          const progressData = {
            loaded: progressEvent.loaded || 0,
            total: progressEvent.total || 100
          };
          onProgress(progressData);
        }
      }
    });
    
    return response.data;
  } catch (error) {
    console.error('Upload error:', error);
    throw error;
  }
}