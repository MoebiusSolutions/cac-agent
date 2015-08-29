package com.moesol.cac.agent.selector;

import java.lang.reflect.InvocationTargetException;
import java.util.Scanner;
import java.util.prefs.Preferences;

public class TtyIdentityKeyChooser implements IdentityKeyChooser {
	private final IdentityKeyListProvider provider;
	private final Scanner sc = new Scanner(System.in);
	
	public TtyIdentityKeyChooser(IdentityKeyListProvider provider) {
		this.provider = provider;
	}
		
	public String chooseFromAliases(final String[] aliases) throws InvocationTargetException, InterruptedException {
		Preferences prefs = Preferences.userNodeForPackage(getClass());
		String choosenAlias = prefs.get("choosenAlias", "");

		int dident = -1;
		int i = 1;
		for (final CertDescription cd : provider.makeCertList(aliases)) {
			System.out.printf("%d) %s%n", i, cd.asTty());
			if (choosenAlias.equals(aliases[i - 1])) {
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
	
}
