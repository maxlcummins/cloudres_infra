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

  const API_BASE_URL = "/api"; 

  const onDrop = useCallback(acceptedFiles => {
    setFiles(acceptedFiles);
    setMessage(""); // Clear any previous messages
    setResults(null); // Clear any previous results
    setShowResults(false); // Hide results when new files are dropped
  }, []);

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
            setMessage("No meaningful results found in the response.");
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

  // Check pipeline status before polling for results
  useEffect(() => {
    if (!runId) return;

    setMessage("Pipeline processing... (this may take around 10-15 minutes)");
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
            setMessage(`Pipeline status: ${statusData.status}... (this may take several minutes)`);
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
    <div className="flex flex-col items-center justify-center min-h-screen">
      {/* Development Mode Panel */}
      {isDevelopment && devModeEnabled && (
  <div className="bg-gray-400 p-2 mb-4 max-w-md w-full text-xs">
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
          className="bg-blue-500 text-white px-2 py-1 rounded text-xs"
        >
          Simulate New Upload
        </button>
        <button
          onClick={() => {
            setMessage("Pipeline complete! (SIMULATED)");
            setCheckingStatus(false);
            const mockResults = `Isolate\tSulfonamide\tESBL (AmpC type)\tEfflux\tFosfomycin\tQuinolone\tAztreonam\tMacrolide\tStreptomycin\tCarbapenemase (MBL)\tOther antimicrobial\tTetracycline\tChloramphenicol\tESBL\tAmikacin/Kanamycin/Tobramycin/Quinolone\tBeta-lactamase (not ESBL or carbapenemase)\tTrimethoprim\nresults\tsul1,sul2\tblaEC-15*\tacrF,mdtM*\tglpT_E448K\tgyrA_D87N,gyrA_S83L,parC_S80I,parE_S458A\tftsI_I336IKYRI\tmph(A)\taadA2,aadA5,aph(3'')-Ib,aph(6)-Id\tblaNDM-5\tble\ttet(B)\tcatA1,catB3^\tblaCTX-M-15\taac(6')-Ib-cr5\tblaOXA-1\tdfrA12,dfrA17`;
            const parsedMockResults = parseTSV(mockResults);
            console.log("Parsed mock results:", parsedMockResults); // Add this line
            setResults(parsedMockResults);
            setShowResults(true);
          }}
          className="bg-green-500 text-white px-2 py-1 rounded text-xs"
        >
          Simulate Completion
        </button>
        <button
          onClick={() => {
            setUploadProgress(prev => (prev + 10) <= 100 ? prev + 10 : 100);
            setMessage(`Simulated Upload Progress: ${uploadProgress}%`);
          }}
          className="bg-yellow-500 text-white px-2 py-1 rounded text-xs"
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
          }}
          className="bg-red-500 text-white px-2 py-1 rounded text-xs"
        >
          Reset All State
        </button>
      </div>
    )}
  </div>
)}

      <div className="max-w-md w-full p-4 mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold text-center flex-grow">CloudRes</h1>
          {runId && (
            <div
              className="text-xs text-gray-500 cursor-pointer hover:text-gray-700"
              onClick={() => setShowRunId(!showRunId)}
              title="Click to copy Run ID"
            >
              {showRunId ? `Run ID: ${runId}` : "ⓘ"}
            </div>
          )}
        </div>

        <div
          {...getRootProps()}
          className={`border-2 border-dashed rounded p-6 text-center cursor-pointer ${isDragActive ? "bg-gray-200" : "hover:bg-gray-100"
            }`}
        >
          <input {...getInputProps()} />
          {isDragActive ? (
            <p>Drop the files here ...</p>
          ) : (
            <p>Drag & drop .fastq.gz files here, or click to select files</p>
          )}
        </div>

        {files.length > 0 && (
          <div className="mt-4">
            <h2 className="text-lg font-medium">Selected Files:</h2>
            <ul className="list-disc list-inside">
              {files.map((file, index) => (
                <li key={index}>{file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)</li>
              ))}
            </ul>
          </div>
        )}

        {uploading && (
          <div className="mt-4">
            <p className="text-center">Uploading... {uploadProgress}%</p>
            <progress value={uploadProgress} max="100" className="w-full h-4 rounded" />
          </div>
        )}

        {checkingStatus && !uploading && (
          <div className="mt-4 flex justify-center">
            <div className="animate-pulse flex space-x-2">
              <div className="h-2 w-2 bg-blue-600 rounded-full"></div>
              <div className="h-2 w-2 bg-blue-600 rounded-full"></div>
              <div className="h-2 w-2 bg-blue-600 rounded-full"></div>
            </div>
          </div>
        )}

        <button
          className="mt-6 w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 disabled:opacity-50"
          onClick={handleUpload}
          disabled={uploading || files.length === 0 || checkingStatus}
        >
          {uploading ? "Uploading..." : "Upload & Start Pipeline"}
        </button>

        {message && (
          <div className="mt-4 p-2 border rounded text-center">
            {message}
            {runId && message.includes("Pipeline started") && (
              <div className="text-xs mt-1 text-gray-500">
                Run ID: <span className="font-mono">{runId}</span>
                <button
                  className="ml-2 text-blue-500 hover:text-blue-700"
                  onClick={() => {
                    navigator.clipboard.writeText(runId);
                  }}
                >
                  Copy
                </button>
              </div>
            )}
          </div>
        )}

        {/* Display error messages if any */}
        {message && message.startsWith("Error") && (
          <div className="mt-4 p-2 border rounded text-center text-red-500">
            {message}
          </div>
        )}

        {showResults && results && results.length > 0 && (
          <div className="mt-6">
            <h2 className="text-2xl font-bold mb-4 text-center">Pipeline Results</h2>
            <div className="overflow-x-auto table-container justify-start">
              <table className="border-collapse custom-table-width">
                <thead>
                  <tr>
                    {Object.keys(results[0]).map((header) => (
                      <th key={header} className="border p-2 bg-gray-400">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {results.map((row, index) => (
                    <tr key={index}>
                      {Object.values(row).map((cell, idx) => (
                        <td key={idx} className="border p-2 text-center">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Run ID Display (for easy access/copying) */}
      {runId && (
        <div className="flex justify-center gap-4 mt-4">
          <button
            onClick={() => {
              fetchResults(); // Call fetchResults when the button is clicked
              setShowResults(prev => !prev);
            }}
            className="bg-blue-600 text-white py-2 px-4 rounded hover:bg-blue-700"
          >
            {showResults ? "Hide Pipeline Results" : "View Pipeline Results"}
          </button>
          <a
            href={devMode ? `${API_BASE_URL}/test/multiqc` : `${API_BASE_URL}/multiqc_report?run_id=${runId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block bg-green-600 text-white py-2 px-4 rounded hover:bg-green-700"
          >
            View MultiQC Report
          </a>
        </div>
      )}

      {/* Footer with Run ID */}
      {runId && (
        <div className="mt-8 text-xs text-gray-400 text-center">
          <span
            className="cursor-pointer hover:text-gray-600"
            onClick={() => {
              navigator.clipboard.writeText(runId);
            }}
          >
            Run ID: {runId}
          </span>
        </div>
      )}
    </div>
  );
}

export default App;