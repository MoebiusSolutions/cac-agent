package com.moesol.cac.agent.selector;

import java.io.Console;
import java.io.IOException;
import java.lang.reflect.InvocationTargetException;
import java.security.cert.X509Certificate;
import java.util.Scanner;
import java.util.prefs.Preferences;

public class TtyIdentityKeyChooser implements IdentityKeyChooser {
	private final IdentityKeyListProvider provider;
	private IdentityKeyCertFormatter formatter;
	private final Scanner sc = new Scanner(System.in);
	
	public TtyIdentityKeyChooser(IdentityKeyListProvider provider) {
		this.provider = provider;
		this.formatter = DefaultCertFormatter.INSTANCE;
	}

	public void setCertFormatter(IdentityKeyCertFormatter formatter) {
		this.formatter = formatter;
	}

	public void showNoIdentitiesFound() {
		System.out.println("No identities found");
	}
		
	public String chooseFromAliases(final String[] aliases) throws InvocationTargetException, InterruptedException {
		Preferences prefs = Preferences.userNodeForPackage(getClass());
		String choosenAlias = prefs.get("choosenAlias", "");

		int dident = -1;
		int i = 1;
		for (final X509Certificate cert : provider.makeCertList(aliases)) {
			String alias = aliases[i - 1];
			String text = formatter.asText(alias, cert);
			System.out.printf("%d) %s%n", i, text);
			if (choosenAlias.equals(alias)) {
				dident = i;
			}
			i++;
		}
		System.out.printf("Select Identity (default %d): ", dident);
		
		String line = sc.nextLine();
		int row = parseLine(line) - 1;
		if (row < 0) {
			row = dident - 1; // Default or -1 if no default.
		}
		if (row >= 0 && row < aliases.length) {
			return aliases[row];
		}
		return null;
	}

	private int parseLine(String line) {
		try {
			return Integer.parseInt(line);
		} catch (NumberFormatException e) {
			return -1;
		}
	}

	public void reportException(final Exception e) {
		System.err.printf("Failed: %s%n", e.getLocalizedMessage());
	}

	@Override
	public void showBusy(String message) {
		System.out.println(message);
	}

	@Override
	public void hideBusy() {
	}

	@Override
	public char[] promptForPin(String title, String prompt) {
		Console cons = System.console();
		if (cons == null) {
			System.err.println("No console, cannot input PIN");
			return new char[0];
		}
		return cons.readPassword("%s%n%s", title, prompt);
	}

	@Override
	public void promptForCardInsertion(String title, String error) {
		System.out.println(title);
		System.out.println(error);
		System.out.println("Insert Smartcard, then press Enter");
		try {
			System.in.read();
		} catch (IOException e) {
			System.err.println("Failed to query for Enter");
			System.exit(1);
		}
	}
	
}
