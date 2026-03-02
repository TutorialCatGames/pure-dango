import readline from "readline";
import
{
    errorLengthCheck,
    joinStrings,
    bigIntPow,
    removeQuotes
} from "../core/utils.ts"
import Decimal from "decimal.js";
import {performance} from "perf_hooks";

type Stack = number[] | string[] | null[];
const MaxTrigonometricDecimalPrecision    : number = 504;
const MaxArcTrigonometricDecimalPrecision : number = 1015;
const TrigonometricGuardDigits            : number = 50;
const NormalDecimalFunctionLimit          : number = 1013;

const CACHE =
{
    pi: new Map<number, Decimal>(),

    ln2:      new Map<number, Decimal>(),
    ln2Terms: new Map<number, Decimal[]>(),

    agm:  new Map<string, Decimal>(),
    asin: new Map<string, Decimal>(),
    acos: new Map<string, Decimal>(),
    atan: new Map<string, Decimal>()
};

function reduceAngle(value: Decimal) : Decimal
{
    const savedPrecision = Decimal.precision;
    Decimal.set({precision: savedPrecision + TrigonometricGuardDigits});

    const _2π = getCachedPi(savedPrecision + TrigonometricGuardDigits).mul(2);
    const reduced = value.mod(_2π);

    Decimal.set({precision: savedPrecision});
    return reduced.toSignificantDigits(savedPrecision);
}

function simpleRounding(normalFunc: (value: number) => any, decimalFunc: (value: Decimal) => Decimal, args: any[], name: string) : any
{
    errorLengthCheck(1, args, name);

    const value = args[0];
    if (!(value instanceof Decimal || typeof value === "bigint" || typeof value === "number")) throw new EvalError(`value can only be type Decimal, BigInt, or Number, but got "${value}" in built-in function "${name}"`);
    
    const result = value instanceof Decimal
        ? decimalFunc(value)
        : (typeof value === "bigint"
            ? normalFunc(Number(value))
            : normalFunc(value)
        );

    return result;
}

function getCachedPi(precision: number): Decimal
{
    if (!CACHE.pi.has(precision))
    {
        let π : Decimal;

        if (precision <= MaxArcTrigonometricDecimalPrecision) π = Decimal.acos(-1);
        else if (precision < 10000) π = ChudnovskySeries(precision); 
        else π = piMachin(precision);

        CACHE.pi.set(precision, π);
    }

    return CACHE.pi.get(precision)!;
}

function atanSmallReciprocal(x: bigint, precision: number) : Decimal
{
    const epsilon  : Decimal = new Decimal(10).pow(-(precision + 5));
    const nDecimal : Decimal = new Decimal(x.toString());
    const nSquared : Decimal = nDecimal.mul(nDecimal);

    let term : Decimal = new Decimal(1).div(x);   // 1/x
    let sum  : Decimal = term;
    let k    : number  = 1;

    while (term.abs().gt(epsilon))
    {
        term = term.div(nSquared).neg();   // -1 / x^2
        const denominator : number = 2 * k + 1;
        sum = sum.add(term.div(denominator));   // (-1 / x^2) / 2 * k + 1
        k++
    }

    return sum;
}

function piMachin(precision : number) : Decimal
{
    const savedPrecision = precision;
    Decimal.set({precision: precision + 50});

    // π/4 = 12 * atan(1/49) + 32 * atan(1/57) - 5 * atan(1/239) + 12 * atan(1/110443)
    const term1 = atanSmallReciprocal(49n,     precision + 50).mul(12);   // 12 * atan(1/49)
    const term2 = atanSmallReciprocal(57n,     precision + 50).mul(32);   // 32 * atan(1/57)
    const term3 = atanSmallReciprocal(239n,    precision + 50).mul(-5);   // - 5 * atan(1/239)
    const term4 = atanSmallReciprocal(110443n, precision + 50).mul(12);   // 12 * atan(1/110443)

    const πOver4  : Decimal = term1.add(term2).add(term3).add(term4);   // term1 + term2 + term3 + term4
    const π       : Decimal = πOver4.mul(4);

    Decimal.set({precision: savedPrecision});
    return π.toDecimalPlaces(precision, Decimal.ROUND_DOWN);
}

function ChudnovskySeries(precision : number) : Decimal
{
    const constantC : Decimal = Decimal(426880).mul(Decimal.sqrt(10005));
    const XFactor   : Decimal = new Decimal("-262537412640768000");
    
    let multinomialFactor : Decimal =  new Decimal(1);
    let powerTerm         : Decimal =  new Decimal(1);
    let linearTerm        : Decimal =  new Decimal(13591409);
    let sum               : Decimal =  new Decimal(13591409);

    const terms : number = Math.ceil(precision / 14) + 2;
    for (let k = 1; k < terms; k++)
    {
        const sK       : Decimal  = new Decimal(6 * k);
        const tK       : Decimal  = new Decimal(3 * k);
        const kDecimal : Decimal  = new Decimal(k);
        const kCubed   : Decimal  = kDecimal.mul(kDecimal).mul(kDecimal);

        // M_k = M_(k-1) * (6k-5)(6k-4)(6k-3)(6k-2)(6k-1)(6k) / (3k-2)(3k-1)(3k) / k^3
        const numerator   : Decimal = sK.sub(5).mul(sK.sub(4)).mul(sK.sub(3)).mul(sK.sub(2)).mul(sK.sub(1)).mul(sK); // (6k-5)(6k-4)(6k-3)(6k-2)(6k-1)(6k)
        const denominator : Decimal = tK.sub(2).mul(tK.sub(1)).mul(tK).mul(kCubed);                                  // (3k-2)(3k-1)(3k) / k^3
        multinomialFactor = multinomialFactor.mul(numerator).div(denominator);

        // X_k = X_(k-1) * -262537412640768000
        powerTerm = powerTerm.mul(XFactor);

        // L_k = L_(k-1) + 545140134
        linearTerm = linearTerm.add(545140134);

        // sum += M_k * L_k / X_k. This is each term of the Chudnovsky Series
        sum = sum
            .add(
                multinomialFactor
                    .mul(linearTerm)
                    .div(powerTerm)
            )
    }

    return constantC.div(sum);
}

function BinarySplittingE(precision: number) : Decimal
{
    // computes Euler's number using binary splitting on the Taylor Series: e = sum(1/k!) for k = 0 to Infinity
    // recursively computes on a range [lowest, highest] as a fraction numerator/denominator
    // then it combines the two fractions (leftNumerator * rightDenominator + rightNumerator) / (leftDenominator * rightDenominator)
    function split(lowest : number, highest : number) : [Decimal, Decimal]
    {
        if (highest - lowest === 1)
        {
            // base case: single term 1/highest!
            const numerator   = new Decimal(1);
            const denominator = new Decimal(highest);
            return [numerator, denominator];
        }

        const mid : number = Math.floor((lowest + highest) / 2);
        const
        [
            leftNumerator,
            leftDenominator
        ] : [Decimal, Decimal] = split(lowest, mid);
        const
        [
            rightNumerator,
            rightDenominator
        ] : [Decimal, Decimal] = split(mid, highest);

        // combine left + right: (leftNumerator * rightDenominator + rightNumerator) / (leftDenominator * rightDenominator)
        const numerator   : Decimal = leftNumerator
            .mul(rightDenominator)
            .add(rightNumerator);
        const denominator : Decimal = leftDenominator.mul(rightDenominator);
        return [numerator, denominator];
    }

    // log2(10) converts decimal digits to the number of binary terms needed
    const log2Of10 : Decimal                            = new Decimal("3.321928094887362347870319429489390175864831393024580612054756395815934776608625215850139743359370155099657371710250251826824096984263526888275302772998655393851951352657505568643017609190024891666941433374011903124187375109715866467540179189655806735830779688432725883274992522448902383559976417394137928009772756686355477901486745057845884780271042254560972234657956955415370191576411717792471651350023921127147339361440723397211574851007094987891658880831322194806793298232325931195067139950783700336734248070663527500840691762638625354688015368621618418860858994835381321499893027044179207865922601822965371575367239660695116486836846623858508486062990542699469279116273206134006446704847634070437352336742212830896703645790921677219090214219621424574446585245359484488154834592514295409373539065494486327792984242915911811311632981257694501981575037921855384878203551601973782772888817598743328660727123938252022133328052551248827434448842453165465061241489182286793252664292811659922851627345082");
    const terms : number                                = Decimal.ceil(new Decimal(precision).mul(log2Of10)).toNumber() + 10;
    const [numerator, denominator] : [Decimal, Decimal] = split(0, terms);
    return new Decimal(1).add(numerator.div(denominator));   // add the k=0 term
}

function arcTrigonometricFunction(decimalFunc: (decimal: Decimal) => Decimal, args: any[], name: string) : Decimal
{
    errorLengthCheck(1, args, name);
    const value : number | Decimal | bigint  = args[0];
    if (value === undefined)                                         throw new SyntaxError(`There must be a value after built-in function "${name}"`);

    const decimal : Decimal = value instanceof Decimal ? value : new Decimal(value.toString());
    return decimalFunc(decimal);
}

function trigonometricFunction(decimalFunc: (decimal: Decimal) => Decimal, args: any[], name: string) : Decimal
{
    errorLengthCheck(1, args, name);
    const value : number | Decimal | bigint  = args[0];
    if (value === undefined)                                      throw new SyntaxError(`There must be a value after built-in function "${name}"`);

    const decimal : Decimal = value instanceof Decimal ? value : new Decimal(value.toString());
    return Decimal.precision > MaxArcTrigonometricDecimalPrecision
        ? decimalFunc(decimal)
        : decimalFunc(reduceAngle(decimal));
}

function atanh(numerator: bigint, denominator: bigint, precision: number) : Decimal
{
    const x        : Decimal = new Decimal(numerator.toString()).div(new Decimal(denominator.toString()));   // numerator/denominator
    const epsilon  : Decimal = new Decimal(10).pow(-(precision + 5));
    const xSquared : Decimal = x.mul(x);
    let   term     : Decimal = x;
    let   sum      : Decimal = x;
    let   k        : number  = 1;

    while (true)
    {
        term = term.mul(xSquared);
        const next = term.div(2 * k + 1);   // term / 2 * k + 1
        sum = sum.add(next);
        if (next.abs().lt(epsilon)) break;
        k++;
    }

    return sum;
}

function ln2Machin(precision: number) : Decimal
{

    if (!CACHE.ln2Terms.has(precision))
    {
        // ln(2) = 18 * atanh(1 / 26) + 2 * atanh(1 / 4801) + 8 * atanh( 1/ 8749)
        CACHE.ln2Terms.set(precision, [
            atanh(1n, 26n,   precision).mul(18),  // 18 * atanh(1 / 26)
            atanh(1n, 4801n, precision).mul(2),   // 2 * atanh(1 / 4801)
            atanh(1n, 8749n, precision).mul(8)    // 8 * atanh( 1/ 8749)
        ])
    }
    const [a, b, c] = CACHE.ln2Terms.get(precision)!;
    return a.add(b).add(c);
}

function decimalAtanh(x: Decimal, precision: number) : Decimal
{
    // atanh(x) = x + x^3/3 + x^5/5 + ... converges fast for small x
    const epsilon  : Decimal = new Decimal(10).pow(-(precision + 5));
    let sum        : Decimal = x;
    let term       : Decimal = x;
    const xSquared : Decimal = x.mul(x);
    let k          : number  = 1;

    while (true)
    {
        k    += 2;
        term  = term.mul(xSquared);              // x^k
        const next : Decimal = term.div(k);      // x^k / k
        sum   = sum.add(next);
        if (next.abs().lt(epsilon)) break;
    }

    return sum;
}

function TaylorSeriesSinCos(x: Decimal, workingPrecision: number) : [Decimal, Decimal]
{
    const epsilon  : Decimal = new Decimal(10).pow(-(workingPrecision + 4));
    const nSquared : Decimal = x.mul(x).neg();   // -x^2 (handles the alternating sign)
    let sinTerm    : Decimal = x;
    let cosTerm    : Decimal = new Decimal(1);
    let sinSum     : Decimal = x;
    let cosSum     : Decimal = new Decimal(1);

    for (let k = 1; sinTerm.abs().gt(epsilon) || cosTerm.abs().gt(epsilon); k++)
    {
        cosTerm = cosTerm.mul(nSquared).div((2 * k - 1) * (2 * k)); // ct * n^2 / ((2 * k - 1) * (2 * k))
        sinTerm = sinTerm.mul(nSquared).div((2 * k) * (2 * k + 1)); // st * n^2 / ((2 * k) * (2 * k + 1))
        cosSum  = cosSum.add(cosTerm);
        sinSum  = sinSum.add(sinTerm);
    }

    return [
        sinSum,
        cosSum
    ];
}

function sinCos(angle: Decimal, precision: number, π: Decimal) : [Decimal, Decimal]
{
    const savedPrecision = Decimal.precision;
    Decimal.set({precision: precision + 32});

    // reduce to [0, π/4]
    let reducedAngle : Decimal = angle.mod(π.mul(2));
    if (reducedAngle.isNeg()) reducedAngle = reducedAngle.add(π.mul(2));

    const octantSize  : Decimal = π.div(4); // π/4
    const octantIndex : number  = ((reducedAngle.div(octantSize).floor().toNumber() % 8) + 8) % 8;
    let octantAngle   : Decimal = reducedAngle.sub(octantSize.mul(octantIndex)).abs();
    if (octantIndex % 2 === 1) octantAngle = octantSize.sub(octantAngle)

    const [sinEstimate, cosEstimate] : [Decimal, Decimal] = TaylorSeriesSinCos(octantAngle, precision + 32);

    // [sinResult, cosResult] for each octant
    // octant symmetry table
    const octantResultTable : [Decimal, Decimal][] =
    [
        [sinEstimate,       cosEstimate      ],   // 0: [0,    π/4]
        [cosEstimate,       sinEstimate      ],   // 1: [π/4,  π/2]
        [cosEstimate,       sinEstimate.neg()],   // 2: [π/2,  3π/4]
        [sinEstimate.neg(), cosEstimate.neg()],   // 3: [3π/4, π]
        [sinEstimate.neg(), cosEstimate.neg()],   // 4: [π,    5π/4]
        [cosEstimate.neg(), sinEstimate.neg()],   // 5: [5π/4, 3π/2]
        [cosEstimate.neg(), sinEstimate      ],   // 6: [3π/2, 7π/4]
        [sinEstimate.neg(), cosEstimate      ],   // 7: [7π/4, 2π]
    ]

    const [sinResult, cosResult] = octantResultTable[octantIndex];

    Decimal.set({precision: savedPrecision});
    return [
        sinResult.toSignificantDigits(precision, Decimal.ROUND_DOWN),
        cosResult.toSignificantDigits(precision, Decimal.ROUND_DOWN)
    ]
}

function asin(x: Decimal, precision: number) : Decimal
{
    const nStr : string = x.toFixed(precision + 32);
    const key  : string = `${nStr}_${precision}`;
    if (CACHE.asin.has(key)) return CACHE.asin.get(key)!;

    const savedPrecision = Decimal.precision;
    Decimal.set({precision: precision + 32});

    const one       : Decimal = Decimal(1);

    if (x.abs().gt(1))   throw new EvalError(`asin's domain is [-1, 1], but got "${x}"`);
    if (x.eq(0))
    {
        Decimal.set({precision: savedPrecision});
        return new Decimal(0);
    }
    
    if (x.eq(1))
    {
        const result : Decimal = getCachedPi(precision + 32).div(2);
        Decimal.set({precision: savedPrecision});
        return result.toDecimalPlaces(precision, Decimal.ROUND_DOWN);
    }
    if (x.eq(one.neg()))
    {
        const result : Decimal = getCachedPi(precision + 32).div(2).neg();
        Decimal.set({precision: savedPrecision});
        return result.toDecimalPlaces(precision, Decimal.ROUND_DOWN);
    }

    // for x more than or equal to 0.4 use asin(x) = π/2 - asin(sqrt(1 - x^2))
    if (x.abs().gte(0.4))
    {
        const π        : Decimal = getCachedPi(precision + 32);
        const sqrtTerm : Decimal = one.sub(x.mul(x)).sqrt();   // sqrt(1 - x^2)

        const result   : Decimal = π.div(2).sub(asin(sqrtTerm, precision + 32));   // π/2 - asin(sqrt(1 - x^2))

        Decimal.set({precision: savedPrecision})
        return x.isNeg()
            ? result.neg().toDecimalPlaces(precision, Decimal.ROUND_DOWN)
            : result.toDecimalPlaces(precision, Decimal.ROUND_DOWN);
    }

    // use atan if x.abs() is between 0.01 and 0.4: atan(n / sqrt(1 - x^2))
    const sqrtTerm : Decimal = one.sub(x.mul(x)).sqrt();                // sqrt(1 - x^2)
    const result   : Decimal = atan(x.div(sqrtTerm), precision + 32);   // atan(x / sqrt(1 - x^2))

    Decimal.set({precision: savedPrecision});

    CACHE.asin.set(key, result);
    return result.toDecimalPlaces(precision, Decimal.ROUND_DOWN);
}

function acos(x: Decimal, precision: number) : Decimal
{
    const nStr : string = x.toFixed(precision + 32);
    const key  : string = `${nStr}_${precision}`;
    if (CACHE.acos.has(key)) return CACHE.acos.get(key)!;

    const savedPrecision = Decimal.precision;
    Decimal.set({precision: precision + 32});

    const π      : Decimal = getCachedPi(precision + 32);  
    const result : Decimal = π.div(2).sub(asin(x, precision + 32));   // π/2 - asin(x)

    CACHE.acos.set(key, result);
    Decimal.set({precision: savedPrecision});
    return result.toDecimalPlaces(precision, Decimal.ROUND_DOWN);   
}

function atan(x : Decimal, precision : number) : Decimal
{
    const nStr : string = x.toFixed(precision + 32);
    const key  : string = `${nStr}_${precision}`;
    if (CACHE.atan.has(key)) return CACHE.atan.get(key)!;

    const savedPrecision : number = Decimal.precision;
    Decimal.set({precision: precision + 32});

    const one  : Decimal = new Decimal(1);
    const absx : Decimal = x.abs();

    // for absx smaller than 0.5 use atan(x) = atanh(x / sqrt(1 + x^2))
    if (absx.lt(0.5))
    {
        // atan(x) = x - x^3/3 + x^5/5 - ... 
        const epsilon  : Decimal = new Decimal(10).pow(-(precision + 5));
        let   sum      : Decimal = x;
        let   term     : Decimal = x;
        const xSquared : Decimal = x.mul(x);
        let   k        : number  = 1;
        let   sign     : Decimal = new Decimal(-1);

        while (true)
        {
            k    += 2;
            term  = term.mul(xSquared);
            const next = term.div(k).mul(sign);
            sum   = sum.add(next);
            sign  = sign.neg();
            if (next.abs().lt(epsilon)) break;
        }

        Decimal.set({precision: savedPrecision});
        return sum.toDecimalPlaces(precision, Decimal.ROUND_DOWN);
    }

    // for absn between 0.5 and 5 use Taylor Series with reduction
    if (absx.lt(5))
    {
        // reduce using atan(x) = 2 * atan(x / (1 + sqrt(1 + x^2)))
        let reduced    : Decimal = x;
        let reductions : number  = 0;

        while (reduced.abs().gte(0.5))
        {
            reduced = reduced.div(one.add(one.add(reduced.mul(reduced)).sqrt()));   // x / (1 + sqrt(1 + x^2))
            reductions++
        }

        const smallResult : Decimal = decimalAtanh(reduced.div(one.add(reduced.mul(reduced)).sqrt()), precision + 32);   // atanh(x / (sqrt(1 + x^2) + 1))
        const result      : Decimal = smallResult.mul(new Decimal(2).pow(reductions));   // 2^reductions * (atanh(x / (sqrt(1 + x^2) + 1)))

        Decimal.set({precision: savedPrecision});
        return result.toDecimalPlaces(precision, Decimal.ROUND_DOWN);
    }


    // for absn >= 5 use: atan(n) = π/2 - atan(1/n)
    const π      : Decimal =  getCachedPi(precision + 32);
    const sign   : number  = x.isNeg() ? -1 : 1;
    const result : Decimal = π.div(2).mul(sign).sub(atan(one.div(x), precision + 32));   // π/2 * sign - atan(1/x)

    Decimal.set({precision: savedPrecision});

    const resultCut : Decimal = result.toDecimalPlaces(precision, Decimal.ROUND_DOWN);
    CACHE.atan.set(key, resultCut);
    return resultCut;
}

function ln(x: Decimal, precision: number) : Decimal
{
    if (x.lte(0)) throw new EvalError(`ln's domain is positive numbers only, but got: "${x}"`);
    
    const two = new Decimal(2);

    // reduce to [1, 2] using ln(x) = ln(x / 2^k) + k * ln(2)
    let k : number        = 0
    let reduced : Decimal = x;

    while (reduced.gt(2))  { reduced = reduced.div(two); k++; }
    while (reduced.lt(1))  { reduced = reduced.mul(two); k--; }

    // ln(x) = π/(2 * AGM(1, 4 * 2^m/x)) - m * ln(2)
    if (!CACHE.ln2.has(precision))
    {
        const ln2    : Decimal = ln2Machin(precision + 10);
        CACHE.ln2.set(precision, ln2);
    }

    const ln2 = CACHE.ln2.get(precision)!; // π/(2 * AGM(1, 2^m * 2))

    // ln(x) = 2 * atanh((x - 1) / (x + 1))
    const atanhArg  : Decimal = reduced.sub(1).div(reduced.add(1));   // (x - 1) / (x + 1), always in [0, 1/3] for x in [1, 2]
    const lnReduced : Decimal = decimalAtanh(atanhArg, precision).mul(2);   // ln(x) = 2 * atanh((x - 1) / (x + 1))

    return lnReduced.add(ln2.mul(k));
}

function pow(a: Decimal, b: Decimal): Decimal
{
    let result : Decimal = new Decimal(1);
    let e      : Decimal = b;

    while (e.gt(0))
    {
        if (e.mod(2).eq(1)) result = result.mul(a);

        a = a.mul(a);
        e = e.div(2).floor();
    }

    return result;
}

function expTaylorSeries(f: Decimal, precision: number) : Decimal
{
    const epsilon : Decimal = new Decimal(10).pow(-(precision + 5));
    let result    : Decimal = new Decimal(1);
    let term      : Decimal = new Decimal(1);
    let k         : number  = 1;

    while (true)
    {
        term   = term.mul(f).div(k);
        result = result.add(term);
        if (term.abs().lt(epsilon)) break;
        k++;
    }

    return result;
}

function exp(x: Decimal, precision: number) : Decimal
{
    if (x.isNeg()) return new Decimal(1).div(exp(x.neg(), precision + 32));
    
    const savedPrecision = Decimal.precision;
    Decimal.set({precision: precision + 32});

    // e^x = e^n * e^f where n is the integer part, f is fractional [0, 1]
    const n : Decimal = x.floor();
    const f : Decimal = x.sub(n);

    const ePowF  : Decimal = expTaylorSeries(f, precision + 32);    // e^f via taylor
    const eBase  : Decimal = BinarySplittingE(precision + 32);      // e
    const ePowN  : Decimal = pow(eBase, n);                         // e^n via squaring
    const result : Decimal = ePowN.mul(ePowF);

    Decimal.set({precision: savedPrecision});
    return result.toDecimalPlaces(precision - 1, Decimal.ROUND_DOWN);   // e^x = e^n * e^f
}

export const syncFunctions =
{
    "now" : () : number =>
    {
        return performance.now();
    },

    "print" : (stack: Stack, _: any, ...args: any[]) : void =>
    {
        const map    : string[] = args.map(string => string instanceof Decimal ? string.toString() : string);
        const joined : string   = joinStrings(map);
        console.log(joined);
    },

    "concat": (stack: Stack, _: any, ...args: any[]) : string =>
    {
        return joinStrings(args)
    },

    "root": (stack: Stack, _: any, ...args: any[]) : number | Decimal | string =>
    {
        errorLengthCheck(3, args, "root");
        const rawBase: any = args[0];
        if (rawBase === undefined) throw new SyntaxError(`There must be a base after built-in function "root"`);
        
        const rawRoot: any = args[1];
        if (rawRoot === undefined) throw new SyntaxError(`There must be an exponent after base: "${rawBase}"`);

        const useNativeMath = !!args[2];          // !! makes it a boolean

        const baseIsNumber  : boolean  =   typeof rawBase === "number";
        const rootIsNumber  : boolean  =   typeof rawRoot === "number";
        const baseIsDecimal : boolean  =   rawBase instanceof Decimal;
        const rootIsDecimal : boolean  =   rawRoot instanceof Decimal;

        if (((baseIsNumber && rawBase === 1) || (baseIsDecimal && rawBase.eq(1)))) return baseIsNumber ? 1 : new Decimal(1);
        if (((baseIsNumber && rawBase === 0) || (baseIsDecimal && rawBase.eq(0))) && ((rootIsNumber && rawRoot < 0) || (rootIsDecimal && rawRoot.isNegative()))) throw new EvalError("Zero cannot have a negative root");
        if ((rootIsNumber && rawRoot === 1) || (rootIsDecimal && rawRoot.eq(1)))   return rawBase;
        if ((rootIsNumber && rawRoot === 0) || (rootIsDecimal && rawRoot.eq(0)))   throw new EvalError("Cannot take zeroth root");

        if ((baseIsNumber && rootIsNumber) || useNativeMath) return Math.pow(Number(rawBase), 1/Number(rawRoot));

        const base : Decimal = baseIsDecimal ? rawBase : new Decimal(rawBase);
        const root : Decimal = rootIsDecimal ? rawRoot : new Decimal(rawRoot);

        if (rootIsNumber && baseIsNumber)
        {
            const reciprocal =  1/(rawRoot as number)
            return Math.pow(rawBase as number, reciprocal)
        }
        else
        {
            const reciprocal = Decimal.div(1, root as Decimal);
            return (base as Decimal).pow(reciprocal).toFixed();
        }
    },

    "raise": (stack: Stack, getTrueValue: Function, ...args: any[]) : number | bigint | Decimal | string =>
    {
        errorLengthCheck(3, args, "raise");
        let base : any = getTrueValue(args[0]);
        if (base === undefined) throw new SyntaxError(`There must be a base after built-in function "raise"`);
        
        let exponent : any = getTrueValue(args[1]);
        if (exponent === undefined) throw new SyntaxError(`There must be an exponent after base: "${base}"`);

        const useNativeMath = !!args[2];

        // early returns
        if (base === 1 || base === 1n) return useNativeMath ? 1 : 1n;
        if ((base === 0 || base === 0n) && (exponent === 0 || exponent === 0n)) throw new EvalError(`0 raised to 0 can't be evaluated`);
        else if (base === 0 || base === 0n) return useNativeMath ? 0 : 0n;
        if (typeof base === "bigint" && exponent < 0n)  throw new EvalError("BigInt cannot have a negative exponent");
        
        if (typeof base === "bigint" || typeof exponent === "bigint") 
        {
            if (typeof base !== "bigint")     base = BigInt(base);
            if (typeof exponent !== "bigint") exponent = BigInt(exponent);

            if (useNativeMath) return Math.pow(Number(base), Number(exponent));
            else return bigIntPow(base, exponent);
        }

        const decimalBase     : Decimal   = base instanceof Decimal ? base : new Decimal(base);
        const decimalExponent : Decimal   = exponent instanceof Decimal ? exponent : new Decimal(exponent);
        const result          : Decimal   = decimalBase.pow(decimalExponent);
        return useNativeMath
            ? result
            : result.toFixed();
    },
    
    "exp": (stack: Stack, getTrueValue: Function, ...args: any[]) : Decimal | number =>
    {
        errorLengthCheck(1, args, "exp");
        const x : any = args[0];
        if (x === undefined) throw new SyntaxError(`There must be an x parameter after built-in function "exp"`);
        if (!(x instanceof Decimal || typeof x === "bigint" || typeof x === "number")) throw new EvalError(`Parameter "exponent" must have a value of type Decimal, BigInt, or Number. But got: "${x}"`);

        const ePowExponent = exp(
                x instanceof Decimal
                    ? x
                    : new Decimal(x), Decimal.precision
            )
        
        return ePowExponent;
    },

    "setPrecision": (stack: Stack, _: any, ...args: any[]) : void =>
    {
        errorLengthCheck(1, args, "setPrecision");
        const x : number   = Number(args[0]);
        if (!Number.isInteger(x) || x <= 0) throw new TypeError(`Decimal precision must be a positive number, but got "${x}"`);

        CACHE.atan.clear();
        CACHE.asin.clear();
        CACHE.acos.clear();
        
        CACHE.ln2.clear();
        CACHE.ln2Terms.clear();

        CACHE.agm.clear();
        CACHE.pi.clear();
        Decimal.set({precision: x});
    },

    "sine": (stack: Stack, getTrueValue: Function, ...args: any[]) : Decimal =>
    {
        return trigonometricFunction((x: Decimal) => {
            const precision = Decimal.precision;
            if (precision > MaxTrigonometricDecimalPrecision)
            {
                const π = getCachedPi(precision);
                return sinCos(x, precision, π)[0]
            }

            return Decimal.sin(x);
        }, args, "sine");
    },

    "cosine": (stack: Stack, getTrueValue: Function, ...args: any[]) : Decimal =>
    {
        return trigonometricFunction((x: Decimal) => {
            const precision = Decimal.precision;
            if (precision > MaxTrigonometricDecimalPrecision)
            {
                const π = getCachedPi(precision);
                return sinCos(x, precision, π)[1]
            }

            return Decimal.cos(x);
        }, args, "cosine");
    },

    "tan": (stack: Stack, getTrueValue: Function, ...args: any[]) : Decimal =>
    {
        return trigonometricFunction((x: Decimal) => {
            const precision = Decimal.precision;
            if (precision > MaxTrigonometricDecimalPrecision) 
            {
                const π = getCachedPi(precision);
                const [sinResult, cosResult] = sinCos(x, precision, π);
                if (cosResult.isZero()) throw new EvalError(`tan is undefined at this angle: "${x}"`);
                
                return sinResult.div(cosResult);
            }

            return Decimal.tan(x)
        }, args, "tan");
    },

    "arcsin": (stack: Stack, getTrueValue: Function, ...args: any[]) : Decimal =>
    {
        return arcTrigonometricFunction(
            (x: Decimal) =>
            {
                if (x.lt(-1) || x.gt(1)) throw new EvalError(`built-in function "arcsin"'s domain is [-1, 1], but got ${x}`);
                return Decimal.precision > MaxArcTrigonometricDecimalPrecision
                    ? asin(x, Decimal.precision)
                    : Decimal.asin(x);
            }, args, "arcsin"
        );
    },

    "arccos": (stack: Stack, getTrueValue: Function, ...args: any[]) : Decimal =>
    {
        return arcTrigonometricFunction(
            (x: Decimal) =>
            {
                if (x.lt(-1) || x.gt(1)) throw new EvalError(`built-in function "arccos"'s domain is [-1, 1], but got ${x}`);
                return Decimal.precision > MaxArcTrigonometricDecimalPrecision
                    ? acos(x, Decimal.precision)
                    : Decimal.acos(x);
            }, args, "arccos"
        );
    },

    "arctan": (stack: Stack, getTrueValue: Function, ...args: any[]) : Decimal =>
    {
        return arcTrigonometricFunction((decimal: Decimal) => {
            return Decimal.precision > MaxArcTrigonometricDecimalPrecision
                ? atan(decimal, Decimal.precision)
                : Decimal.atan(decimal);
        }, args, "arctan");
    },

    "getPi": (stack: Stack, getTrueValue: Function, ...args: any[]) : Decimal =>
    {
        errorLengthCheck(1, args, "getPi");
        const customPrecision : any = args[0];
        const isInTypeRange : boolean = 
            typeof customPrecision === "number" ||
            typeof customPrecision === "bigint" ||
            customPrecision instanceof Decimal 

        const savedPrecision : number = Decimal.precision;

        let precision : number;
        if      (customPrecision !== undefined && isInTypeRange)  precision = Number(customPrecision);
        else if (customPrecision !== undefined && !isInTypeRange) throw new EvalError(`Parameter "customPrecision" can only be type Number, BigInt, or Decimal. But got: "${customPrecision}"`);
        else                                                      precision = savedPrecision;

        if (precision <= 0)   throw new EvalError(`Parameter "customPrecision" in built-in function "getPi" must be positive`);

        Decimal.set({precision: precision + 10});   // use custom prec. Guarding digits

        const π : Decimal = precision < MaxArcTrigonometricDecimalPrecision ? Decimal.acos(-1) : ChudnovskySeries(precision);

        Decimal.set({precision: savedPrecision});   // return prec
        return π.toDecimalPlaces(precision - 1, Decimal.ROUND_DOWN);   // Decimal.ROUND_DOWN makes the last digit unrounded
    },

    "getE": (stack: Stack, getTrueValue: Function, ...args: any[]) : Decimal =>
    {
        errorLengthCheck(1, args, "getE");
        const customPrecision : any = args[0];
        const isInTypeRange : boolean =
            typeof customPrecision === "number" ||
            typeof customPrecision === "bigint" ||
            customPrecision instanceof Decimal;

        const savedPrecision : number = Decimal.precision;

        let precision : number;
        if      (customPrecision !== undefined && isInTypeRange)  precision = Number(customPrecision);
        else if (customPrecision !== undefined && !isInTypeRange) throw new EvalError(`Parameter "customPrecision" can only be type Number, BigInt, or Decimal. But got: "${customPrecision}"`);
        else                                                      precision = savedPrecision;

        if (precision <= 0) throw new EvalError(`Parameter "customPrecision" in built-in function "getE" must be positive`);

        Decimal.set({precision: precision + 10});   // guard digits

        const e : Decimal = precision > MaxArcTrigonometricDecimalPrecision ? BinarySplittingE(precision + 10) : Decimal.exp(1);

        Decimal.set({precision: savedPrecision});   // restore prec
        return e.toDecimalPlaces(precision - 1, Decimal.ROUND_DOWN);
    },

    "random": (stack: Stack, getTrueValue: Function, ...args: any[]) : number | Decimal | bigint =>
    {
        errorLengthCheck(3, args, "random");

        if (args.length === 0) return Math.random();

        let min : number | Decimal | bigint = args[0];
        if (args.length === 1) throw new Error(`There must be a max after min: "${min}"`);

        let max : number | Decimal | bigint = args[1];
        const returnInteger = !!args[2];

        if (min instanceof Decimal || max instanceof Decimal)
        {
            if (!(min instanceof Decimal)) min = new Decimal(min);
            if (!(max instanceof Decimal)) max = new Decimal(max);

            const result = Decimal.random(Decimal.precision).mul(max.sub(min)).add(min)
            return returnInteger ? result.toDecimalPlaces() : result;
        }

        else if (typeof min === "bigint" || typeof max === "bigint")
        {
            const minBigint = BigInt(min);
            const maxBigint = BigInt(max);

            const range = maxBigint - minBigint;    // the range is smaller than max because Math.random(range + 1n) has to not have a chance to be greater than max
            const random = BigInt(Math.floor(Math.random() * (Number(range + 1n))));
            const result = minBigint + random;

            return returnInteger ? result : Number(result);
        }

        const result = (min as number) + Math.random() * ((max as number) - (min as number));
        return returnInteger ? Math.round(result) : result;
    },

    "ceil": (stack: Stack, getTrueValue: Function, ...args: any[]) : number | Decimal => 
    {
        return simpleRounding((x: number) => Math.ceil(x), (x: Decimal) => x.ceil(), args, "ceil");
    },

    "floor": (stack: Stack, getTrueValue: Function, ...args: any[]) : number | Decimal  => 
    {
        return simpleRounding((x: number) => Math.floor(x), (x: Decimal) => x.floor(), args, "floor");
    },

    "round": (stack: Stack, getTrueValue: Function, ...args: any[]) : number | Decimal  => 
    {
        return simpleRounding((x: number) => Math.round(x), (x: Decimal) => x.round(), args, "round"); 
    },
    
    "abs": (stack: Stack, getTrueValue: Function, ...args: any[]) : number | bigint | Decimal => 
    {
        const x : number | Decimal | bigint = args[0];
        if (typeof x === "bigint") return x < 0n ? -x : x;   // abs doesn't work on BigInt :3
        return simpleRounding((value: number) => Math.abs(value), (value: Decimal) => value.abs(), args, "abs");
    },

    "log": (stack: Stack, getTrueValue: Function, ...args: any[]) : Decimal => 
    {
        errorLengthCheck(2, args, "log");
        const rawValue : number | Decimal | bigint  = args[0];
        if (rawValue === undefined) throw new SyntaxError(`There must be a value after built-in function "log"`);
        
        const x : Decimal = rawValue instanceof Decimal ? rawValue : new Decimal(rawValue);

        const precisionCheck = Decimal.precision > NormalDecimalFunctionLimit;
        if (args.length === 1) return precisionCheck ? ln(x, Decimal.precision) : Decimal.ln(x);   // use natural log if there's no base

        const rawBase : number | Decimal | bigint  = args[1];
        const base : Decimal  = rawBase instanceof Decimal ? rawBase : new Decimal(rawBase);

        if (base.eq(1)) throw new EvalError("Logarithm base cannot be 1");
        if (x.lte(0)) throw new EvalError(`Logarithm x must be positive: ${x}`);

        const lnValue = precisionCheck ? ln(x, Decimal.precision) : Decimal.ln(x);
        const lnBase  = precisionCheck ? ln(base, Decimal.precision)  : Decimal.ln(base);
        return lnValue.div(lnBase);    // log formula for every base is ln(value) / ln(base)
    },

    /*
        .reduce: loops and compares all arguments. The element returned will be used in the next iteration.
        .some:   checks if at least one element matches a condition
    */
    "min": (stack: Stack, getTrueValue: Function, ...args: any[]) : any => 
    {
        if (args.length === 0) throw new SyntaxError(`built-in function "min" needs at least one argument`);

        const hasDecimal : boolean  = args.some(argument => argument instanceof Decimal);

        if (hasDecimal)
        {
            return args.reduce((argument1, argument2) =>
            {
                const decimalArgument1 = argument1 instanceof Decimal ? argument1 : new Decimal(argument1);
                const decimalArgument2 = argument2 instanceof Decimal ? argument2 : new Decimal(argument2);
                return decimalArgument1.lt(decimalArgument2) ? decimalArgument1 : decimalArgument2;   // return the lesser number
            })   
        }

        else return args.reduce((argument1, argument2) =>
        {
            return argument1 < argument2 ? argument1 : argument2;
        })
    },

    "max": (stack: Stack, getTrueValue: Function, ...args: any[]) : any => 
    {
        if (args.length === 0) throw new SyntaxError(`built-in function "max" needs at least one argument`);

        const hasDecimal : boolean  = args.some(argument => argument instanceof Decimal);

        if (hasDecimal)
        {
            return args.reduce((argument1, argument2) =>
            {
                const decimalArgument1 = argument1 instanceof Decimal ? argument1 : new Decimal(argument1);
                const decimalArgument2 = argument2 instanceof Decimal ? argument2 : new Decimal(argument2);
                return decimalArgument1.gt(decimalArgument2) ? decimalArgument1 : decimalArgument2;   // return the greater number
            })   
        }

        else return args.reduce((argument1, argument2) =>
        {
            return argument1 > argument2 ? argument1 : argument2;
        })
    },

    "len": (stack: Stack, getTrueValue: Function, ...args: any[]) : number =>
    {
        let x : any = args[0];

        if (typeof x === "string")    x = removeQuotes(x);
        else if (!Array.isArray(x))   throw new TypeError(`Parameter "x" in built-in function "len" can only be type String or Array. But got: "${x}"`);

        return x.length;
    },

    "push": (stack: Stack, getTrueValue: Function, ...args: any[]) : void =>
    {
        const array : any = args[0];

        if (!Array.isArray(array)) throw new TypeError(`First argument to built-in function "push" must be an Array. But got: ${array}`);
        for (let i = 1; i < args.length; i++) array.push(args[i]);
    },

    "pop": (stack: Stack, getTrueValue: Function, ...args: any[]) : any =>
    {
        errorLengthCheck(1, args, "pop");

        const array : any = args[0];
        if (!Array.isArray(array)) throw new TypeError(`First argument to built-in function "push" must be an Array. But got: ${array}`);
        
        return array.pop() ?? null;
    },
};

export const asyncFunctions =
{
    "input": async (stack: Stack, getTrueValue: Function, ...args: any[]) : Promise<string> =>
    {
        let joinedStrings : string  = joinStrings(args);

        const rl : readline.Interface = readline.createInterface(
            {
                input  : process.stdin,
                output : process.stdout
            }
        );

        const inputValue = await new Promise(resolve => {
            rl.question(joinedStrings, answer => resolve(answer));
        });

        rl.close();

        return getTrueValue(inputValue);
    }
};