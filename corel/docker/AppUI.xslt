<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:frmwrk="Corel Framework Data">
  <xsl:output method="xml" encoding="UTF-8" indent="yes"/>
  <frmwrk:uiconfig>
    <frmwrk:applicationInfo userConfiguration="true"/>
  </frmwrk:uiconfig>
  <xsl:template match="node()|@*">
    <xsl:copy><xsl:apply-templates select="node()|@*"/></xsl:copy>
  </xsl:template>
  <xsl:template match="uiConfig/items">
    <xsl:copy>
      <xsl:apply-templates select="node()|@*"/>
      <itemData guid="dfe2333b-464d-4382-ab49-9fcd1ed8185e" noBmpOnMenu="true"
                type="checkButton" check="*Docker('8bd64b52-8cd8-4246-a420-deeac27682dc')"
                dynamicCategory="2cc24a3e-fe24-4708-9a74-9c75406eebcd"
                userCaption="T-Cut" enable="true"/>
      <itemData guid="5e15ca4d-02a4-4f1c-90d9-452126178a7f"
                type="wpfhost"
                hostedType="Addons\TCutDocker\TCutPanel.dll,TCutDocker.TCutPanel"
                enable="true" width="430"/>
    </xsl:copy>
  </xsl:template>
  <xsl:template match="uiConfig/dockers">
    <xsl:copy>
      <xsl:apply-templates select="node()|@*"/>
      <dockerData guid="8bd64b52-8cd8-4246-a420-deeac27682dc"
                  userCaption="T-Cut" wantReturn="true" focusStyle="noThrow">
        <container>
          <item dock="fill" margin="0,0,0,0" guidRef="5e15ca4d-02a4-4f1c-90d9-452126178a7f"/>
        </container>
      </dockerData>
    </xsl:copy>
  </xsl:template>
</xsl:stylesheet>
