package com.moesol.cac.agent.selector;

import java.awt.Component;
import java.lang.reflect.InvocationTargetException;

public interface IdentityKeyChooser {
	void setApplicationName(String applicationName);
	void setParentComponent(Component parentComponent);
	void setCertFormatter(IdentityKeyCertFormatter formatter);
	void showNoIdentitiesFound(String remoteHost);
	String chooseFromAliases(String remoteHost, String[] aliases) throws InvocationTargetException, InterruptedException;
	void reportException(final Exception e);
	void showBusy(String string);
	void hideBusy();
	char[] promptForPin(String title, String prompt);
	void promptForCardInsertion(String title, String error);
}
