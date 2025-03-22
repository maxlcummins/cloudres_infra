// src/api.js
import axios from "axios";

const api = axios.create({
  baseURL: "http://127.0.0.1:8000",
});

export const uploadFiles = async (files) => {
  const formData = new FormData();
  files.forEach((file) => {
    formData.append("files", file);
  });

  try {
    const response = await api.post("/upload", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });

    console.log("Response Status:", response.status);
    console.log("Response Data:", response.data);

    if (response.data && response.data.error) { // Check for error in response data
      throw new Error(response.data.error);
    }

    return response.data;
  } catch (error) {
    console.error("API Error:", error);
    if (axios.isAxiosError(error)) {
        if (!error.response) {
            throw new Error("Network Error");
        } else {
            throw new Error(error.response.data.error || "Upload failed");
        }
    } else {
        throw error;
    }
  }
};