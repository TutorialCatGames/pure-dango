// runtime errors
class ConstantAssignmentOperator extends Error
{
    constructor(variableName)
    {
        super(`Assignment to a constant "${variableName}"`);
        this.name = "ConstantAssignmentOperator";
    }
}

class FunctionError extends Error
{
    constructor(functionName)
    {
        super(`Function "${functionName}" does not exist`);
        this.name = "FunctionError";
    }
}

class StackError extends Error
{
    constructor()
    {
        super(`POP on empty stack`);
        this.name = "StackError";
    }
}

class MissingStackTokenError extends Error
{
    constructor(expected)
    {
        super(`Expected a value after "${expected}"`);
        this.name = "MissingTokenError";
    }
}

class BreakError extends Error
{
    constructor()
    {
        super("Break statement outside of loop");
        this.name = "BreakError";
    }
}

class ContinueError extends Error
{
    constructor()
    {
        super("Continue statement outside of loop");
        this.name = "ContinueError";
    }
}

class DivisionByZero extends Error
{
    constructor(left, right)
    {
        super(`Operands must not divide by 0: "${left}/${right}`);
        this.name = "DivisionByZero";
    }
}

export const runtimeErrors =
{
    FunctionError,
    ConstantAssignmentOperator,
    BreakError,
    ContinueError,
    StackError,
    MissingStackTokenError,
    DivisionByZero
}

// parsing errors
class SyntaxError extends Error
{
    constructor(message, row, column) {
        super(`${message} at row ${row}, char ${column}`);
        this.name = "SyntaxError";
    }
}

class FunctionCallError extends SyntaxError {
    constructor(message, row, column) {
        super(message, row, column);
        this.name = "FunctionCallError";
    }
}

class ChainedFunctionCallError extends SyntaxError
{
    constructor (name, row, column)
    {
        super(`Chained function calls are not allowed: "${name}(...)()"`, row, column);
        this.name = "ChainedFunctionCallError";
    }
}

class ChainedIncDecError extends SyntaxError
{
    constructor (row, column)
    {
        super(`Chained increment/decrement operators are not allowed`, row, column);
        this.name = "ChainedIncDecError";
    }
}

class InvalidPostfixError extends SyntaxError
{
    constructor (operator, type, value, row, column)
    {
        super(`Cannot apply "${operator}" to ${type.toLocaleLowerCase()} "${value}"`, row, column);
        this.name = "InvalidPostfixError";
    }
}

class AssignmentError extends SyntaxError
{
    constructor(operator, row, column)
    {
        super(`Left side of "${operator}" must be a variable`, row, column);
        this.name = "AssignmentError";
    }
}

class UnexpectedTokenError extends SyntaxError
{
    constructor(tokenValue, row, column)
    {
        super(`Unexpected token "${tokenValue}"`, row, column);
        this.name = "UnexpectedTokenError";
    }
}

class MissingTokenError extends SyntaxError
{
    constructor(expected, row, column)
    {
        super(`Expected "${expected}"`, row, column);
        this.name = "MissingTokenError";
    }
}

class MissingRightSide extends SyntaxError
{
    constructor(after, row, column)
    {
        super(`Expected an expression or value after "${after}"`, row, column);
        this.name = "MissingTokenError";
    }
}


export const parseErrors = 
{
    FunctionCallError,
    ChainedFunctionCallError,
    ChainedIncDecError,
    AssignmentError,
    UnexpectedTokenError,
    MissingTokenError,
    InvalidPostfixError,
    MissingRightSide
}

// utils errors

class NegativeExponentError extends Error
{
    constructor(exponent)
    {
        super(`Exponent "${exponent}" must be positive when raising BigInt`);
        this.name = "NegativeExponentError";
    }
}

export const utilsErrors = 
{
    NegativeExponentError,
}