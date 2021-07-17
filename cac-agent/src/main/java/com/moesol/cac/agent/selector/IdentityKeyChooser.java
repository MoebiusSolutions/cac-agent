package com.moesol.cac.agent.selector;

import java.lang.reflect.InvocationTargetException;

public interface IdentityKeyChooser {
	void showNoIdentitiesFound();
	String chooseFromAliases(final String[] aliases) throws InvocationTargetException, InterruptedException;
	void reportException(final Exception e);
	void showBusy(String string);
	void hideBusy();
	char[] promptForPin(String title, String prompt);
	void promptForCardInsertion(String title, String error);
}
