import * as introspection from "./introspection";

/**
 * Run the automation functions from the command line.
 * This is just a convenience for testing and debugging.
 *
 * @param method The method to run
 * @param args The arguments to pass to the method
 *
 * @example
 * npm run cli -- getProjectIdByNumber 22
 */
export async function run(method: string, ...args: string[]) {
    let result;

    switch (method) {
        case "printActionManifests":
            result = introspection.printActionManifests(
                introspection.getActionManifests(introspection.getExportedFunctions(args[0]))
            );
            break;
        case "writeActionManifests":
            introspection.writeActionManifests(
                introspection.getActionManifests(introspection.getExportedFunctions(args[0]))
            );
            result = "Action manifests written successfully.";
            break;
        default:
            // eslint-disable-next-line no-console
            console.warn("Unknown method");
            break;
    }

    if (result !== undefined) {
        // eslint-disable-next-line no-console
        console.debug(result);
    }
}

run(process.argv[2], ...process.argv.slice(3))
