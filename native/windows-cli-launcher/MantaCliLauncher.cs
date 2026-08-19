using System;
using System.Diagnostics;
using System.IO;
using System.Text;

internal static class MantaCliLauncher
{
    private static int Main(string[] args)
    {
        try
        {
            string launcherDirectory = Path.GetDirectoryName(typeof(MantaCliLauncher).Assembly.Location);
            string resourcesDirectory = Directory.GetParent(launcherDirectory).FullName;
            string appDirectory = Directory.GetParent(resourcesDirectory).FullName;
            string electronPath = Path.Combine(appDirectory, "Manta.exe");
            string cliPath = Path.Combine(
                resourcesDirectory,
                "app.asar.unpacked",
                "out",
                "cli",
                "index.js"
            );

            if (!File.Exists(electronPath))
            {
                Console.Error.WriteLine("Unable to locate Manta.exe next to \"{0}\"", resourcesDirectory);
                return 1;
            }

            if (!File.Exists(cliPath))
            {
                Console.Error.WriteLine("Unable to locate the Manta CLI entrypoint at \"{0}\"", cliPath);
                return 1;
            }

            ProcessStartInfo startInfo = new ProcessStartInfo
            {
                FileName = electronPath,
                Arguments = BuildArguments(cliPath, args),
                UseShellExecute = false
            };

            // Why: launching without cmd.exe preserves embedded newlines while matching the
            // packaged batch launcher's Electron-as-Node environment contract.
            // Why: ProcessStartInfo's env copy rejects duplicate PATH/Path keys; mutating this
            // short-lived process preserves the native block for child inheritance (#12046).
            MoveEnvironmentVariable("NODE_OPTIONS", "MANTA_NODE_OPTIONS");
            MoveEnvironmentVariable("NODE_REPL_EXTERNAL_MODULE", "MANTA_NODE_REPL_EXTERNAL_MODULE");
            Environment.SetEnvironmentVariable("ELECTRON_RUN_AS_NODE", "1");
            Environment.SetEnvironmentVariable("MANTA_WINDOWS_PACKAGED_CLI_LAUNCHER", "1");
            string requestedCliCommand = Environment.GetEnvironmentVariable("MANTA_CLI_COMMAND");
            Environment.SetEnvironmentVariable(
                "MANTA_CLI_COMMAND",
                requestedCliCommand == "manta-ide" ? "manta-ide" : "manta"
            );

            using (Process child = Process.Start(startInfo))
            {
                child.WaitForExit();
                return child.ExitCode;
            }
        }
        catch (Exception error)
        {
            Console.Error.WriteLine("Unable to start the Manta CLI: {0}", error.Message);
            return 1;
        }
    }

    private static void MoveEnvironmentVariable(string sourceName, string targetName)
    {
        string value = Environment.GetEnvironmentVariable(sourceName);
        Environment.SetEnvironmentVariable(sourceName, null);
        // Why: a null value clears the target, matching the previous unconditional Remove.
        Environment.SetEnvironmentVariable(targetName, value);
    }

    private static string BuildArguments(string cliPath, string[] args)
    {
        StringBuilder commandLine = new StringBuilder(QuoteArgument(cliPath));
        foreach (string arg in args)
        {
            commandLine.Append(' ');
            commandLine.Append(QuoteArgument(arg));
        }
        return commandLine.ToString();
    }

    private static string QuoteArgument(string value)
    {
        bool requiresQuotes = value.Length == 0;
        for (int index = 0; index < value.Length && !requiresQuotes; index += 1)
        {
            requiresQuotes = value[index] == '"' || Char.IsWhiteSpace(value[index]);
        }
        if (!requiresQuotes)
        {
            return value;
        }

        StringBuilder quoted = new StringBuilder("\"");
        int backslashCount = 0;
        foreach (char character in value)
        {
            if (character == '\\')
            {
                backslashCount += 1;
                continue;
            }

            if (character == '"')
            {
                quoted.Append('\\', backslashCount * 2 + 1);
                quoted.Append('"');
            }
            else
            {
                quoted.Append('\\', backslashCount);
                quoted.Append(character);
            }
            backslashCount = 0;
        }

        quoted.Append('\\', backslashCount * 2);
        quoted.Append('"');
        return quoted.ToString();
    }
}
