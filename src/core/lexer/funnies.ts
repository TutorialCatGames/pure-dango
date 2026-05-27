import fs   from "fs";
import path from "path";

const counterFile = path.join(process.env.LOCALAPPDATA || process.cwd(), "pure-dango", "quote_crimes.json");

export function getQuoteCrimes() : number
{
    try
    {
        const data = fs.readFileSync(counterFile, "utf8");
        return JSON.parse(data).count ?? 0;
    }
    catch
    { 
        return 0;
    }
}

export function resetQuoteCrimes()
{
    const zero = 0;
    fs.mkdirSync(path.dirname(counterFile), {recursive: true});
    fs.writeFileSync(counterFile, JSON.stringify({zero}));
    return zero;
}

export function incrementQuoteCrimes() : number
{
    const count = getQuoteCrimes() + 1;
    fs.mkdirSync(path.dirname(counterFile), {recursive: true});
    fs.writeFileSync(counterFile, JSON.stringify({count}));
    return count;
}

export function QuoteCrimesMessage(count: number, opening : string) : string
{
    if (count <= 1)
        return `oops you broke the quotes! Quote was opened with ${opening}, but closed with another ${opening}.`
    else if (count <= 3)
        return `oops you broke the quotes, again. Quote was opened with ${opening}, but closed with another ${opening}.`;
    else if (count <= 5)
        return `you broke the quotes AGAIN. This is the ${count}th time. Do you even read the errors?`;
    else if (count <= 9)
        return `I'm starting to think you're doing this on purpose`;
    else if (count <= 14)
        return `at this point just use straight quotes. It's gonna benefit both of us`;
    
    return `${count} times.`;
}