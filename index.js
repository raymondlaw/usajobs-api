const fs = require("fs");
const http = require("http");
const https = require("https");

// --- Configuration ---
const usajobs_api_base = new URL("https://data.usajobs.gov/api/search");
const credentials = require("./auth/credentials.json");
const port = process.env.PORT || 3000;
const user_agent = process.env.USER_AGENT || credentials["User-Agent"];
const authorization_key = process.env.AUTHORIZATION_KEY || credentials["Authorization-Key"];
const request_headers = {
    "Host":"data.usajobs.gov",
    "User-Agent":user_agent,
    "Authorization-Key":authorization_key,
};
const response_headers = {
    "Content-Type": "text/html; charset=utf-8",
};

// --- Server Setup ---
const server = http.createServer();
server.on("request", handle_request);
server.on("listening", handle_listen);
server.listen(port);

// --- Handlers ---
function handle_listen(){
    console.log(`Now Listening on Port ${port}`);
}
function handle_request(req, res){
    console.log(`New Request from ${req.socket.remoteAddress} for ${req.url}`);
    if(req.url === "/"){
        const form = fs.createReadStream("html/index.html");
        res.writeHead(200, response_headers);
        form.pipe(res);
    }
    else if (req.url.startsWith("/search")){
        const user_input = new URL(req.url, `http://${req.headers.host}`).searchParams;
        console.log(`Received: ${user_input.toString()}`);
        const keyword = user_input.get("keyword") || "";
        const location_name = user_input.get("location_name") || "";
        get_job_information(keyword, location_name, res);
    }
    else{
        res.writeHead(404, response_headers);
        res.end(`<h1>404 Not Found</h1>`);
    }
}

// --- USAJOBS.gov Service ---
function get_job_information(keyword, location_name, res){
    const usajobs_url = new URL(usajobs_api_base);
    if (keyword) {
        usajobs_url.searchParams.set("keyword", keyword);
    }
    if (location_name) {
        usajobs_url.searchParams.set("location_name", location_name);
    }
    const jobs_req = https.request(usajobs_url, {method:"GET", headers:request_headers});
    const request_data = {keyword, location_name};
    jobs_req.once("response", (jobs_res) => process_http_stream(jobs_res, parse_jobs_results, request_data, res));
    jobs_req.once("error", (err) => serve_results(keyword, location_name, [], 500, res));
    jobs_req.setTimeout(5000, function () {
        console.log("Request timed out!");
        jobs_req.destroy();
        serve_results(keyword, location_name, [], 504, res);
    });
    jobs_req.end();  // Sends the Request
}

// --- Utility Function ---
function process_http_stream(stream, callback, ...args) {
    const {statusCode: status_code} = stream;
    let body = "";
    stream.on("data", function (chunk) {
        body += chunk;
    });
    stream.on("end", () => callback(body, status_code, ...args));
}

// --- Parse Results ---
function parse_jobs_results(data, status_code, request_data, res) {
    let response_code = status_code;
    let jobs = [];
    if(status_code.toString().startsWith("2")) {
        try {
            const jobs_object = JSON.parse(data);
            jobs = jobs_object?.SearchResult?.SearchResultItems || [];
            if (jobs.length === 0){
                response_code = 404;
            }
            else{
                response_code = 200;
            }
        }
        catch (err) {
            console.error("JSON parse error:", err);
            response_code = 500;
        }
    }
    else if (status_code === 401) {
        response_code = 401;
    }
    else if (status_code === 404) {
        response_code = 404;
    }
    else {
        response_code = 500;
    }
    serve_results(request_data.keyword, request_data.location_name, jobs, response_code, res);
}

// --- Format Job ---
function format_job (job) {
    const job_descriptor = job?.MatchedObjectDescriptor;
    const title = job_descriptor?.PositionTitle;
    const url = job_descriptor?.PositionURI;
    const description = job_descriptor?.QualificationSummary;
    return `
        <li>
            <a href="${url}">${title}</a>
            <p>${description}</p>
        </li>
    `;
}

// --- Serve Results ---
function serve_results(keyword, location_name, jobs, response_code, res) {
    let results_html = "<h1>USA Jobs Demo</h1>";
    switch (response_code) {
    case 200:
        const results = jobs.map(format_job).join("");
        results_html += `<h2>Search Results: ${keyword || "All Jobs"} in ${location_name || "Everywhere"}</h2>${results}`;
        break;
    case 401:
        results_html += "<h2>Unauthorized, either the API Key was changed or is not setup.</h2>"
        break;
    case 404:
        results_html += `<h2>No Results Found for  ${keyword} in ${location_name}</h2>`;
        break;
    case 504:
        results_html += "<h2>API Error, Gateway Timeout</h2>";
        break;
    default:
        results_html += `<h2>API Error (${response_code})</h2>`;
    }
    res.writeHead(response_code, response_headers);
    res.end(results_html);
}
