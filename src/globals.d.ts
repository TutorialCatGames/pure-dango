declare namespace NodeJS
{
    interface Process
    {
        pkg?:
        {
            entrypoint: string;
            defaultEntryPoint: string;
        };
    }
}

declare const PACKAGE_NAME:          string | undefined;
declare const PACKAGE_VERSION:       string | undefined;
declare const PACKAGE_DESCRIPTION:   string | undefined;