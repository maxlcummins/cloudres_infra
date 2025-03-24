import React, { useState, useEffect, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import './index.css';

// Simple CSV parser function
function parseTSV(data) {
  const lines = data.split("\n").filter(line => line.trim() !== "");
  if (lines.length === 0) {
    return [];
  }
  const headers = lines[0].split("\t"); // Split by tab
  return lines.slice(1).map(line => {
    const values = line.split("\t"); // Split by tab
    return headers.reduce((obj, header, index) => {
      obj[header] = values[index] ? values[index].trim() : "";
      return obj;
    }, {});
  });
}

function App() {
  const isDevelopment = process.env.NODE_ENV === 'development';
  const devModeEnabled = import.meta.env.VITE_DEV_MODE === 'true';
  const [devMode, setDevMode] = useState(isDevelopment && devModeEnabled);
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [runId, setRunId] = useState(null);
  const [message, setMessage] = useState("");
  const [results, setResults] = useState(null);
  const [showResults, setShowResults] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [showRunId, setShowRunId] = useState(false);
  const [lookupRunId, setLookupRunId] = useState("");

  const API_BASE_URL = "/api"; 

  const onDrop = useCallback(acceptedFiles => {
    setFiles(acceptedFiles);
    setMessage(""); // Clear any previous messages
    setResults(null); // Clear any previous results
    setShowResults(false); // Hide results when new files are dropped
  }, []);

  const downloadTestDataFiles = () => {
    // Helper function to trigger a file download
    const downloadFile = (filename) => {
      const link = document.createElement('a');
      link.href = `${API_BASE_URL}/api/download-test-data/${filename}`;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    };
  
    // Download both files with a small delay between them
    downloadFile('reads_R1.fastq.gz');
    setTimeout(() => downloadFile('reads_R2.fastq.gz'), 500);
  };

  const handleUpload = async () => {
    if (files.length === 0) {
      setMessage("Please select files to upload.");
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    setMessage("Uploading files...");

    const formData = new FormData();
    files.forEach(file => {
      formData.append("files", file);
    });

    try {
      const uploadRes = await fetch(`${API_BASE_URL}/upload`, {
        method: "POST",
        body: formData,
      });

      if (uploadRes.ok) {
        const uploadData = await uploadRes.json();
        setRunId(uploadData.run_id);
        setMessage("Upload complete. Pipeline started...");
      } else {
        setMessage(`Upload failed: ${uploadRes.status} ${uploadRes.statusText}`);
      }
    } catch (err) {
      setMessage("Upload failed: " + err.message);
    } finally {
      setUploading(false);
    }
  };

  // Separate function to fetch results once pipeline is complete
  const fetchResults = async () => {
    console.log("fetchResults called");
    try {
      console.log(`Fetching results for run ID: ${runId}`);
      const resultsRes = await fetch(`${API_BASE_URL}/results?run_id=${runId}`);
  
      console.log(`Results response: ${resultsRes.status}`);
  
      if (resultsRes.ok) {
        const contentType = resultsRes.headers.get('content-type');
        console.log("Results content type:", contentType);
  
        const responseText = await resultsRes.text();
        console.log("Results response first 100 chars:", responseText.substring(0, 100));
  
        // Check if response is HTML
        if (responseText.includes('<!doctype html>') || responseText.includes('<html')) {
          console.error("Received HTML instead of data:", responseText.substring(0, 100));
          setMessage("Error: Received HTML instead of data. Check API configuration.");
          return;
        }
  
        try {
          const parsedResults = parseTSV(responseText); // Use parseTSV
          console.log("Parsed results:", parsedResults);
  
          if (parsedResults.length > 0 && Object.keys(parsedResults[0]).length > 0) {
            setResults(parsedResults);
            setMessage("Pipeline complete! Results loaded.");
            setShowResults(true);
          } else {
            setMessage("Results not ready yet.");
          }
        } catch (parseError) {
          console.error("Error parsing TSV:", parseError);
          setMessage("Error parsing results: " + parseError.message);
        }
      } else {
        if (resultsRes.status === 202) {
          const messageText = await resultsRes.text();
          setMessage(messageText); // Display the message from the backend
        } else if (resultsRes.status === 404) {
          setMessage("Results not found. Please ensure the pipeline has completed successfully.");
        }
         else {
          setMessage(`Error fetching results: ${resultsRes.status} ${resultsRes.statusText}`);
        }
      }
    } catch (err) {
      console.error("Error fetching results:", err);
      setMessage("Error fetching results: " + err.message);
    } finally {
      setCheckingStatus(false);
    }
  };
  
  // Function to fetch results by a user-provided Run ID
  const fetchResultsByRunId = async () => {
    if (!lookupRunId.trim()) return;
    
    setCheckingStatus(true);
    setMessage(`Looking up results for Run ID: ${lookupRunId}`);
    
    try {
      const resultsRes = await fetch(`${API_BASE_URL}/results?run_id=${lookupRunId}`);
      
      if (resultsRes.ok) {
        const responseText = await resultsRes.text();
        
        // Check if response is HTML
        if (responseText.includes('<!doctype html>') || responseText.includes('<html')) {
          setMessage("Error: Received HTML instead of data. Check API configuration.");
          return;
        }
        
        try {
          const parsedResults = parseTSV(responseText);
          
          if (parsedResults.length > 0 && Object.keys(parsedResults[0]).length > 0) {
            setResults(parsedResults);
            setRunId(lookupRunId); // Set the current runId to the one we looked up
            setMessage("Results loaded for Run ID: " + lookupRunId);
            setShowResults(true);
          } else {
            setMessage("No results found for this Run ID.");
          }
        } catch (parseError) {
          setMessage("Error parsing results: " + parseError.message);
        }
      } else {
        if (resultsRes.status === 202) {
          const messageText = await resultsRes.text();
          setMessage(messageText);
        } else if (resultsRes.status === 404) {
          setMessage("No results found for this Run ID. The pipeline may still be running or the ID may be invalid.");
        } else {
          setMessage(`Error fetching results: ${resultsRes.status} ${resultsRes.statusText}`);
        }
      }
    } catch (err) {
      setMessage("Error fetching results: " + err.message);
    } finally {
      setCheckingStatus(false);
    }
  };

  // Check pipeline status before polling for results
  useEffect(() => {
    if (!runId) return;

    setMessage("Pipeline processing... (this may take around 10-15 minutes per sample)");
    setCheckingStatus(true);

    const statusInterval = setInterval(async () => {
      try {
        console.log(`Polling status for run ID: ${runId}`);
        const statusRes = await fetch(`${API_BASE_URL}/status?run_id=${runId}`);

        console.log(`Status response: ${statusRes.status}`);

        if (statusRes.ok) {
          const statusData = await statusRes.json();
          console.log("Status data:", statusData);

          if (statusData.status === "completed") {
            clearInterval(statusInterval);
            setMessage("Pipeline complete! Fetching results...");
            fetchResults();
          } else {
            setMessage(`Pipeline status: ${statusData.status}... (this may take around 10-15 minutes per sample)`);
          }
        } else {
          console.error(`Status check failed: ${statusRes.status} ${statusRes.statusText}`);
        }
      } catch (err) {
        console.error("Status check error:", err);
      }
    }, 10000);

    return () => {
      clearInterval(statusInterval);
      setCheckingStatus(false);
    };
  }, [runId]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/gzip': ['.fastq.gz']
    },
    maxSize: 1000000000
  });

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
      {/* Development Mode Panel */}
      {isDevelopment && devModeEnabled && (
        <div className="bg-gray-800 text-white p-3 mb-6 mx-auto max-w-7xl w-full text-xs rounded-md shadow-md">
          <label className="flex items-center">
            <input
              type="checkbox"
              checked={devMode}
              onChange={(e) => setDevMode(e.target.checked)}
              className="mr-2"
            />
            Development Mode
          </label>
          {devMode && (
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                onClick={() => {
                  const testRunId = "test-" + Math.random().toString(36).substring(2, 8);
                  setRunId(testRunId);
                  setMessage("Pipeline processing... (SIMULATED)");
                  setCheckingStatus(true);
                }}
                className="bg-blue-600 text-white px-3 py-1 rounded-md text-xs hover:bg-blue-700 transition-colors"
              >
                Simulate New Upload
              </button>
              <button
                onClick={() => {
                  setMessage("Pipeline complete! (SIMULATED)");
                  setCheckingStatus(false);
                  const mockResults = `Isolate\tSulfonamide\tESBL (AmpC type)\tEfflux\tFosfomycin\tQuinolone\tAztreonam\tMacrolide\tStreptomycin\tCarbapenemase (MBL)\tOther antimicrobial\tTetracycline\tChloramphenicol\tESBL\tAmikacin/Kanamycin/Tobramycin/Quinolone\tBeta-lactamase (not ESBL or carbapenemase)\tTrimethoprim\nresults\tsul1,sul2\tblaEC-15*\tacrF,mdtM*\tglpT_E448K\tgyrA_D87N,gyrA_S83L,parC_S80I,parE_S458A\tftsI_I336IKYRI\tmph(A)\taadA2,aadA5,aph(3'')-Ib,aph(6)-Id\tblaNDM-5\tble\ttet(B)\tcatA1,catB3^\tblaCTX-M-15\taac(6')-Ib-cr5\tblaOXA-1\tdfrA12,dfrA17`;
                  const parsedMockResults = parseTSV(mockResults);
                  console.log("Parsed mock results:", parsedMockResults);
                  setResults(parsedMockResults);
                  setShowResults(true);
                }}
                className="bg-green-600 text-white px-3 py-1 rounded-md text-xs hover:bg-green-700 transition-colors"
              >
                Simulate Completion
              </button>
              <button
                onClick={() => {
                  setUploadProgress(prev => (prev + 10) <= 100 ? prev + 10 : 100);
                  setMessage(`Simulated Upload Progress: ${uploadProgress}%`);
                }}
                className="bg-yellow-600 text-white px-3 py-1 rounded-md text-xs hover:bg-yellow-700 transition-colors"
              >
                Test Upload Progress
              </button>
              <button
                onClick={() => {
                  setFiles([]);
                  setUploading(false);
                  setUploadProgress(0);
                  setRunId(null);
                  setMessage("");
                  setResults(null);
                  setShowResults(false);
                  setCheckingStatus(false);
                  setLookupRunId("");
                }}
                className="bg-red-600 text-white px-3 py-1 rounded-md text-xs hover:bg-red-700 transition-colors"
              >
                Reset All State
              </button>
            </div>
          )}
        </div>
      )}

      <div className="container mx-auto px-4 py-8">
        <header className="mb-8">
          <h1 className="text-4xl font-bold text-center bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">CloudRes</h1>
          <p className="text-center text-gray-600 mt-3 max-w-2xl mx-auto">
          A cloud-based genomic analysis platform for read preprocessing, genomic assembly and sequence typing and antimicrobial resistance screening.<br />
          <br /> 
          Upload your FASTQ files to identify antimicrobial resistance genes, virulence factors, and more.
        </p>        
      </header>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left Column - Upload Form */}
          <div className="bg-white p-6 rounded-xl shadow-lg">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-semibold text-gray-800">Upload Files</h2>
              {runId && (
                <div
                  className="text-xs text-gray-500 cursor-pointer hover:text-blue-600 transition-colors"
                  onClick={() => setShowRunId(!showRunId)}
                  title="Click to copy Run ID"
                >
                  {showRunId ? `Run ID: ${runId}` : 
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                    </svg>
                  }
                </div>
              )}
            </div>

            {/* File Upload Section */}
            <div
              {...getRootProps()}
              className={`border-2 border-dashed rounded-lg p-8 mb-6 text-center transition-all duration-200 ${
                isDragActive 
                  ? "bg-blue-50 border-blue-400" 
                  : "hover:bg-gray-50 border-gray-300"
              }`}
            >
              <input {...getInputProps()} />
              <div className="flex flex-col items-center justify-center">
                <svg className="w-12 h-12 mb-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path>
                </svg>
                {isDragActive ? (
                  <p className="text-blue-600 font-medium">Drop the files here ...</p>
                ) : (
                  <>
                    <p className="font-medium text-gray-700 mb-1">Drag & drop .fastq.gz files here, or click to select files</p>
                    <p className="text-sm text-gray-500">Maximum file size: 1GB</p>
                  </>
                )}
              </div>
            </div>

            {/* Selected Files Section */}
            {files.length > 0 && (
              <div className="mb-6 bg-gray-50 p-4 rounded-lg border border-gray-200">
                <h2 className="text-lg font-medium mb-2 text-gray-800 flex items-center">
                  <svg className="w-5 h-5 mr-2 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                  </svg>
                  Selected Files
                </h2>
                <ul className="space-y-1">
                  {files.map((file, index) => (
                    <li key={index} className="flex items-center text-sm">
                      <svg className="w-4 h-4 mr-2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path>
                      </svg>
                      <span className="font-mono text-gray-600">{file.name}</span>
                      <span className="ml-2 text-xs text-gray-500">({(file.size / 1024 / 1024).toFixed(2)} MB)</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Upload Progress Bar */}
            {uploading && (
              <div className="mb-6">
                <div className="flex justify-between mb-1">
                  <p className="text-sm font-medium text-blue-600">Uploading...</p>
                  <p className="text-sm font-medium text-blue-600">{uploadProgress}%</p>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2.5">
                  <div 
                    className="bg-blue-600 h-2.5 rounded-full transition-all duration-300 ease-in-out" 
                    style={{ width: `${uploadProgress}%` }}
                  ></div>
                </div>
              </div>
            )}

            {/* Status Indicator */}
            {checkingStatus && !uploading && (
              <div className="mb-6 flex justify-center">
                <div className="flex items-center space-x-2 text-blue-600">
                  <div className="animate-pulse flex space-x-2">
                    <div className="h-2 w-2 bg-blue-600 rounded-full animate-bounce"></div>
                    <div className="h-2 w-2 bg-blue-600 rounded-full animate-bounce" style={{ animationDelay: "0.2s" }}></div>
                    <div className="h-2 w-2 bg-blue-600 rounded-full animate-bounce" style={{ animationDelay: "0.4s" }}></div>
                  </div>
                  <span className="text-sm font-medium">Processing...</span>
                </div>
              </div>
            )}

            {/* Upload Button */}
            <button
              className={`w-full py-3 px-4 rounded-md font-medium transition-colors duration-200 flex items-center justify-center ${
                uploading || files.length === 0 || checkingStatus
                  ? uploading ? "bg-blue-600 text-white" : "bg-gray-400 cursor-not-allowed text-white"
                  : "bg-blue-600 hover:bg-blue-700 text-white shadow-md hover:shadow-lg"
              }`}
              onClick={handleUpload}
              disabled={uploading || files.length === 0 || checkingStatus}
            >
              {uploading ? (
                <>
                  <svg className="animate-spin -ml-1 mr-3 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Uploading...
                </> 
              ) : (
                <>
                  <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path>
                  </svg>
                  Upload & Start Pipeline
                </>
              )}
            </button>

            {/* Status Messages */}
            {message && !uploading && (
              <div className={`mt-6 p-4 rounded-md ${
                message.startsWith("Error") 
                  ? "bg-red-50 border border-red-200 text-red-700" 
                  : message.includes("complete") 
                    ? "bg-green-50 border border-green-200 text-green-700"
                    : "bg-blue-50 border border-blue-200 text-blue-700"
              }`}>
                <div className="flex items-center">
                  {message.startsWith("Error") ? (
                    <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                    </svg>
                  ) : message.includes("complete") ? (
                    <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                    </svg>
                  ) : (
                    <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                    </svg>
                  )}
                  <p>{message}</p>
                </div>
                
                {runId && message.includes("Pipeline started") && (
                  <div className="mt-2 pt-2 border-t border-blue-200 text-xs text-blue-700 flex items-center">
                    <span className="font-medium mr-1">Run ID:</span> 
                    <code className="font-mono bg-blue-100 px-1 py-0.5 rounded">{runId}</code>
                    <button
                      className="ml-2 text-blue-600 hover:text-blue-800 transition-colors"
                      onClick={() => {
                        navigator.clipboard.writeText(runId);
                      }}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"></path>
                      </svg>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Action Buttons */}
            {runId && (
              <div className="flex justify-center flex-wrap gap-4 mt-6">
                {/* Only show report buttons when complete */}
                {message && message.includes("complete") && (
                  <>
                    <a
                      href={devMode ? `${API_BASE_URL}/test/nextflow` : `${API_BASE_URL}/nextflow_report?run_id=${runId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center bg-indigo-600 text-white py-2 px-4 rounded-md hover:bg-indigo-700 transition-colors shadow-md"
                    >
                      <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                      </svg>
                      View Nextflow Report
                    </a>
                    <a
                      href={devMode ? `${API_BASE_URL}/test/multiqc` : `${API_BASE_URL}/multiqc_report?run_id=${runId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center bg-green-600 text-white py-2 px-4 rounded-md hover:bg-green-700 transition-colors shadow-md"
                    >
                      <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                      </svg>
                      View MultiQC Report
                    </a>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Right Column - Results or Information */}
          <div className="bg-white p-6 rounded-xl shadow-lg">
            {showResults && results && results.length > 0 ? (
              <div>
                <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-3 -mx-6 -mt-6 rounded-t-xl mb-6">
                  <h2 className="text-xl font-bold text-white">Pipeline Results</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        {Object.keys(results[0]).map((header) => (
                          <th key={header} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            {header}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {results.map((row, index) => (
                        <tr key={index} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                          {Object.values(row).map((cell, idx) => (
                            <td key={idx} className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center p-8">
                <div className="bg-blue-50 rounded-full p-6 mb-4">
                  <svg className="w-16 h-16 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"></path>
                  </svg>
                </div>
                <h2 className="text-2xl font-bold text-gray-700 mb-2">No Results Yet</h2>
                <p className="text-gray-500 max-w-md mb-6">
                  Upload your FASTQ files using the form on the left to start the analysis pipeline. Once complete, your results will appear here.
                </p>
                
                {/* Run ID Lookup Widget */}
                <div className="mt-2 w-full max-w-md">
                  <div className="border-t border-gray-200 pt-4 mt-2">
                    <p className="text-sm text-gray-600 mb-2">Or look up results with an existing Run ID:</p>
                    <div className="flex">
                      <input
                        type="text"
                        value={lookupRunId}
                        onChange={(e) => setLookupRunId(e.target.value)}
                        placeholder="Enter Run ID"
                        className="flex-grow px-3 py-2 border border-gray-200 rounded-l-md text-sm text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-gray-50"
                      />
                      <button
                        onClick={fetchResultsByRunId}
                        disabled={!lookupRunId.trim() || checkingStatus}
                        className={`px-3 py-2 rounded-r-md text-sm ${
                          !lookupRunId.trim() || checkingStatus
                            ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                            : "bg-blue-600 text-white hover:bg-blue-700"
                        }`}
                      >
                        {checkingStatus ? (
                          <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                        ) : (
                          "Look Up"
                        )}
                      </button>
                    </div>
                  </div>
                </div>
                
                {runId && !showResults && (
                  <div className="mt-8 p-4 bg-blue-50 rounded-lg border border-blue-100 max-w-md">
                    <h3 className="text-lg font-semibold text-blue-700 mb-2">Analysis in Progress</h3>
                    <p className="text-blue-600 mb-4">
                      Your files are being processed with Run ID: <code className="font-mono bg-blue-100 px-1 py-0.5 rounded">{runId}</code>
                    </p>
                    <button
                      onClick={fetchResults}
                      className="bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 transition-colors"
                    >
                      Check for Results
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        
        {/* Test Data Download Button with increased top margin */}
        <div className="mt-10 mb-8 flex justify-center">
          <button 
            onClick={downloadTestDataFiles}
            className="flex items-center bg-gray-100 text-gray-700 py-2 px-4 rounded-md hover:bg-gray-200 transition-colors shadow-sm border border-gray-300"
          >
            <svg className="w-5 h-5 mr-2 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path>
            </svg>
            Download Test Reads
          </button>
        </div>

        {/* Footer */}
        {runId && (
          <div className="mt-8 mb-4 text-xs text-gray-500 text-center">
            <span
              className="cursor-pointer hover:text-blue-600 transition-colors flex items-center justify-center"
              onClick={() => {
                navigator.clipboard.writeText(runId);
              }}
            >
              <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
              </svg>
              Run ID: <code className="font-mono ml-1 bg-gray-100 px-1 py-0.5 rounded">{runId}</code>
            </span>
          </div>
        )}

        {/* Page Footer with Logo */}
        <div className="mt-8 mb-4 pt-6 border-t border-gray-200 flex flex-col items-center justify-center">
          <img 
            src="/CloudRes.png" 
            alt="CloudRes Logo" 
            className="h-128 mb-4 opacity-80" 
          />
          
          <div className="flex items-center gap-6 mb-4">
            {/* GitHub Link */}
            <a 
              href="https://github.com/yourusername/cloudres" 
              target="_blank" 
              rel="noopener noreferrer"
              className="flex items-center text-gray-600 hover:text-blue-600 transition-colors"
            >
              <svg className="w-5 h-5 mr-1" fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
              </svg>
              GitHub
            </a>
            
            {/* Contact Email */}
            <a 
              href="mailto:max.l.cummins@gmail.com" 
              className="flex items-center text-gray-600 hover:text-blue-600 transition-colors"
            >
              <svg className="w-5 h-5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path>
              </svg>
              max.l.cummins@gmail.com
            </a>
          </div>
          
          <p className="text-xs text-gray-400">© 2025 CloudRes</p>
        </div>




        </div>
      </div>
  );
}

export default App;