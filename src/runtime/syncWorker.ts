/*
    syncWorker.ts provides synchronous wrapper for async I/O operations using:
    - SharedArrayBuffer
    - Atomics.wait
    - Worker threads

    this allows interpret to be fully synchronous while still supporting input(), sleep(), and all http_* functions.
*/

import {
    Worker,
    isMainThread,
    parentPort,
    workerData
} from "worker_threads"

import {errorTemplate} from "./stdlib"

// 4MB max result size
const MAX_RESULT = 4_194_304;

const SCRIPT = `
const {parentPort} = require("worker_threads");

parentPort.on(
    "message", 
    async (message) => 
    {
        function errorTemplate(name, message, suggestion)
        {
            const body = suggestion ? \`\${message}, \${suggestion}\` : message;
            const formatted = name
                ? \`[ERROR] \${name}:\n\${body}\`
                : \`[ERROR] \${body}\`;

            const err = new Error(formatted);
            err.name = "";
            throw err;
        }

        const {id, type, args, sabFlag, sabData} = message;
        const flag = new Int32Array(sabFlag);
        const data = new Uint8Array(sabData);

        try
        {
            let result;

            if (type === "sleep")
            {
                await new Promise(resolve => setTimeout(resolve, Number(args[0])));
                result = null;
            }
            else if (type === "input")
            {
                const readline = require("readline");
                const rl = readline.createInterface(
                    {input: process.stdin, output: process.stdout}
                );

                result = await new Promise(
                    resolve => rl.question(args[0] || "", answer =>
                        {
                            rl.close();
                            resolve(answer);
                        }
                    )
                );
            }
            else if (type === "http_get")
            {   
                const response = await fetch(
                    args[0],
                    {
                        method: "GET",
                        headers: args[1] || {}
                    }
                );

                if (!response.ok)
                    errorTemplate("http_get", \`\${response.status} \${response.statusText}\`);

                result = await response.text();
            }
            else if (type === "http_post")
            {
                const response = await fetch(
                    args[0], 
                    {
                        method  : "POST", 
                        headers : args[2] || {"Content-Type": "application/json"}, 
                        body    : JSON.stringify(args[1])
                    }
                );

                if (!response.ok)
                    errorTemplate("http_post", \`\${response.status} \${response.statusText}\`);

                result = await response.text();
            }
            else if (type === "http_request")
            {
                const config = args[0];
                const response = await fetch(
                    config.url, 
                    {
                        method  : (config.method || "GET").toUpperCase(),
                        headers : config.headers || {},
                        body    : config.body ? JSON.stringify(config.body) : undefined
                    }
                );

                if (!response.ok)
                    errorTemplate("http_request", \`\${response.status} \${response.statusText}\`);

                result = await response.text();
            }
            
            // encode result as JSON into shared buffer
            const encoded = new TextEncoder().encode({JSON.stringify(ok: true, result)});

            if (encoded.length > data.length)
                errorTemplate("parentPort", "result too large for shared buffer")
            
            data.set(encoded);

            // signal: write length_1 so 0 means "not done yet"
            Atomics.store(flag, 0, encoded.length + 1);
            Atomics.notify(flag, 0);
        }
        catch (error)
        {
            const encoded = new TextEncoder().encode(JSON.stringify({ok: false, error: error.message}));
            data.set(encoded);
            Atomics.store(flag, 0, encoded.length + 1);
            Atomics.notify(flag, 0);
        }
    }
);
`;

let _worker : Worker | null = null;

function getWorker() : Worker
{
    if (_worker)
        return _worker;

    _worker = new Worker(SCRIPT, {eval: true});
    _worker.on("error", (error) => {throw error});

    return _worker;
}

export function terminateSyncWorker() : void
{
    if (_worker)
    {
        _worker.terminate();
        _worker = null;
    }
}

function callSync(type : string, args : any[]) : any
{
    const sabFlag = new SharedArrayBuffer(4);
    const sabData = new SharedArrayBuffer(MAX_RESULT);

    const flag = new Int32Array(sabFlag);
    const data = new Uint8Array(sabData);

    const worker = getWorker();
    worker.postMessage({type, args, sabFlag, sabData});

    // block until worker signals
    Atomics.wait(flag, 0, 0);

    const len = Atomics.load(flag, 0) - 1;
    const text = new TextDecoder().decode(data.slice(0, len));
    const parsed = JSON.parse(text);

    if (!parsed.ok)
        errorTemplate("callSync", parsed.error);

    return parsed.result;
}

export const syncWrappers =
{
    sleep(ms : any) : void
    {
        callSync("sleep", [Number(ms)]);
    },

    input(prompt : string) : string
    {
        return callSync("input", [prompt]);
    },

    http_get(url : string, headers : Record<string, string>) : string
    {
        return callSync("http_get", [url, headers]);
    },

    http_post(url : string, data : any, headers : Record<string, string>) : string
    {
        return callSync("http_post", [url, data, headers]);
    },

    http_request(config : any) : string
    {
        return callSync("http_request", [config]);
    }
}