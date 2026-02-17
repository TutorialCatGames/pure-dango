export const constants = Object.create(null);

constants["null"] = true;
constants["true"] = true;
constants["false"] = true;

export function isConstant(name)
{
    return constants[name] === true;
}